-- 0037_message_replies.sql
--
-- Phase 18 (Slice 2 follow-up): threaded replies. A message may quote an earlier
-- message in the SAME thread (messages.reply_to_id). No new table / no new policy —
-- a reply is just a column on the existing messages row, so the 0012/0034 RLS
-- (sender or recipient only) already governs visibility. The two send/edit triggers
-- are re-asserted (full body reproduced) to:
--   * INSERT: validate that reply_to_id, when set, references a message the sender
--     can actually see (a message in their own thread) — under the caller's own RLS,
--     so an outsider (§8) can't quote a DM they can't read; cross-thread quoting is
--     rejected (invalid_reply).
--   * UPDATE: treat reply_to_id as immutable (an edit can't rewire what it replies to),
--     alongside id/sender/recipient/created_at.
-- Idempotent so it can be re-pasted into the SQL editor.

-- ── messages.reply_to_id — the quoted message (same thread) ───────────────────
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages (id) on delete set null;

create index if not exists messages_reply_to_idx on public.messages (reply_to_id);

-- Re-assert the send trigger (0034) WITH reply validation. SECURITY INVOKER + pinned
-- search_path (unchanged). Full body reproduced.
create or replace function public.handle_message_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recent integer;
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

  -- Rate limit: at most 20 sends per 10-second window per sender.
  select count(*) into v_recent
    from public.messages
   where sender_id = auth.uid()
     and created_at > now() - interval '10 seconds';
  if v_recent >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Re-assert the edit trigger (0036) WITH reply_to_id immutable. Full body reproduced.
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
