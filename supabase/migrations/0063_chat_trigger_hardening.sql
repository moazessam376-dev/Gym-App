-- 0063_chat_trigger_hardening.sql
--
-- Three chat-trigger fixes, recreated together because they touch the same two trigger
-- functions (avoid recreating either twice across files):
--
--   * M-2 (server-side disclaimer gate). The per-person chat disclaimer (0039
--     chat_acknowledgments) was enforced CLIENT-SIDE only — a direct PostgREST
--     messages.insert skipped it. Enforce it in handle_message_insert: on FIRST CONTACT
--     (no prior message either direction) the sender must have an acknowledgments row for
--     (auth.uid(), recipient). Existing threads are grandfathered (predate the gate). The
--     workout-note chat mirror (0051) is exempt (workout_note_id set) — it isn't a
--     free-form DM and the athlete↔coach link is already established; without this exempt
--     the 0051 best-effort insert would be silently dropped on first contact.
--
--   * M-7 (message flood). Tighten the burst limit 20→10 / 10s AND add a per-recipient
--     rolling-hour cap so one user can't dominate a single peer's inbox (no per-thread
--     mute in V1).
--
--   * M-6 (note-clear edit forge). The 0056 early-return (FK SET NULL clears
--     workout_note_id) returned NEW verbatim, so a client could also forge edited_at /
--     original_body on that one message in the same UPDATE. Pin them so the ONLY legal
--     mutation on that path is the pure workout_note_id → null clear.
--
-- Both functions stay SECURITY INVOKER + pinned search_path; service_role / seed
-- (auth.uid() null) pass through. Full bodies reproduced (migrations.md). Idempotent.

-- ── handle_message_insert: disclaimer gate + tighter rate limits ──────────────
create or replace function public.handle_message_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recent integer;
  v_to_peer integer;
begin
  if current_user = 'service_role' then
    return new;  -- trusted server path
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser (RLS bypassed); not a client request
  end if;

  -- Banned accounts cannot send (§8 safety). Generic error to the client (§4).
  if exists (select 1 from public.profiles where id = auth.uid() and banned_at is not null) then
    raise exception 'banned' using errcode = 'P0001';
  end if;

  -- The server owns the sender identity.
  new.sender_id := auth.uid();

  -- A reply may only quote a message the sender can see (their own thread). The read
  -- runs under the caller's RLS, so an outsider who can't see the DM is rejected.
  if new.reply_to_id is not null then
    if not exists (
      select 1 from public.messages
       where id = new.reply_to_id
         and (sender_id = auth.uid() or recipient_id = auth.uid())
    ) then
      raise exception 'invalid_reply' using errcode = 'P0001';
    end if;
  end if;

  -- First-contact disclaimer gate (M-2). A free-form DM that opens a NEW thread requires
  -- the per-person acknowledgment (0039). Existing threads are grandfathered; the
  -- workout-note mirror (workout_note_id set) is exempt. Generic error (§4).
  if new.workout_note_id is null
     and not exists (
       select 1 from public.messages
        where (sender_id = auth.uid() and recipient_id = new.recipient_id)
           or (sender_id = new.recipient_id and recipient_id = auth.uid())
     )
     and not exists (
       select 1 from public.chat_acknowledgments
        where user_id = auth.uid() and peer_id = new.recipient_id
     ) then
    raise exception 'disclaimer_required' using errcode = 'P0001';
  end if;

  -- Rate limit: at most 10 sends per rolling 10-second window per sender (M-7).
  select count(*) into v_recent
    from public.messages
   where sender_id = auth.uid()
     and created_at > now() - interval '10 seconds';
  if v_recent >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  -- Per-recipient cap: at most 200 messages to one peer per rolling hour (M-7) — blocks
  -- sustained one-on-one flooding while staying generous for real back-and-forth.
  select count(*) into v_to_peer
    from public.messages
   where sender_id = auth.uid()
     and recipient_id = new.recipient_id
     and created_at > now() - interval '1 hour';
  if v_to_peer >= 200 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ── handle_message_update: pin edited_at / original_body on the note-clear path ─
create or replace function public.handle_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return new;  -- trusted server path
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser (RLS bypassed); not a client request
  end if;

  -- A foreign-key ON DELETE SET NULL cascade (the linked workout_note was deleted)
  -- clears workout_note_id ONLY — it is not a user edit. Let it through untouched so the
  -- chat copy survives. edited_at / original_body are pinned too (M-6) so this path can't
  -- be used to forge an edit marker; the ONLY legal mutation here is workout_note_id→null.
  if old.workout_note_id is not null and new.workout_note_id is null
     and new.body          is not distinct from old.body
     and new.sender_id     is not distinct from old.sender_id
     and new.recipient_id  is not distinct from old.recipient_id
     and new.reply_to_id   is not distinct from old.reply_to_id
     and new.media_id      is not distinct from old.media_id
     and new.created_at    is not distinct from old.created_at
     and new.edited_at     is not distinct from old.edited_at
     and new.original_body is not distinct from old.original_body then
    return new;
  end if;

  -- Only the sender edits, and only the body — id/identity/threading/reply target/
  -- timestamps are fixed.
  if new.id           is distinct from old.id
     or new.sender_id    is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.reply_to_id  is distinct from old.reply_to_id
     or new.created_at   is distinct from old.created_at then
    raise exception 'message_immutable_fields' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid() and banned_at is not null) then
    raise exception 'banned' using errcode = 'P0001';
  end if;

  if old.created_at <= now() - interval '15 minutes' then
    raise exception 'edit_window' using errcode = 'P0001';
  end if;

  new.edited_at := now();
  new.original_body := coalesce(old.original_body, old.body);
  return new;
end;
$$;
