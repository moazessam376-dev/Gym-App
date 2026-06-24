-- 0036_chat_engagement.sql
--
-- Phase 18 (Slice 2): chat engagement extras on top of the Slice-1 safety core
-- (0034). Two pieces, both shipped WITH their RLS in this migration (§2):
--
--   1. Soft message EDIT — a sender may correct their OWN recent message. We add
--      messages.edited_at (so the UI can show an "edited" marker) and a
--      history-preserving original_body (the FIRST original text is captured on the
--      first edit and never overwritten — editing can't quietly erase what was said,
--      which matters for the §8 safety story). A BEFORE-UPDATE trigger owns these
--      columns, enforces a short edit window, blocks edits from a banned account, and
--      forbids touching sender/recipient/created_at. The UPDATE policy is sender-only.
--
--   2. message_reactions — a participant reacts to a message in their own thread with
--      one of a fixed emoji allowlist. user_id is server-set (a trigger, like
--      messages.sender_id); RLS limits every row to the two parties of the underlying
--      message (the same "read messages under your own RLS" trick the report trigger
--      uses, so an outsider who can't see the DM, §8, can't react or read reactions).
--      A banned account can't react (ban = no chat engagement, consistent with send).
--
-- Idempotent so it can be re-pasted into the SQL editor.

-- ── messages.edited_at + original_body — soft, history-preserving edit ────────
alter table public.messages add column if not exists edited_at     timestamptz;  -- null = never edited (UTC, §11)
alter table public.messages add column if not exists original_body text;          -- the FIRST original, set once on first edit

-- BEFORE UPDATE: the server owns edited_at / original_body, enforces the rules.
-- SECURITY INVOKER (default) + pinned search_path; the ban read is the caller's own
-- profile row, always RLS-visible to them. service_role and the seed path
-- (auth.uid() null) pass through untouched.
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

  -- Only the sender edits, and only the body — id/identity/threading/timestamps are fixed.
  if new.id           is distinct from old.id
     or new.sender_id    is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.created_at   is distinct from old.created_at then
    raise exception 'message_immutable_fields' using errcode = 'P0001';
  end if;

  -- Banned accounts cannot edit (ban = no chat engagement, §8). Generic error (§4).
  if exists (select 1 from public.profiles where id = auth.uid() and banned_at is not null) then
    raise exception 'banned' using errcode = 'P0001';
  end if;

  -- Short edit window: a message can be corrected for 15 minutes after it was sent.
  if old.created_at <= now() - interval '15 minutes' then
    raise exception 'edit_window' using errcode = 'P0001';
  end if;

  -- Server-owned edit bookkeeping. original_body keeps the FIRST original forever
  -- (coalesce so a second edit doesn't overwrite it).
  new.edited_at := now();
  new.original_body := coalesce(old.original_body, old.body);
  return new;
end;
$$;

drop trigger if exists messages_handle_update on public.messages;
create trigger messages_handle_update
  before update on public.messages
  for each row execute function public.handle_message_update();

-- Update: a sender may edit their OWN message (the trigger enforces the rest).
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

grant update on public.messages to authenticated;

-- ── message_reactions — emoji reactions on a thread message ───────────────────
create table if not exists public.message_reactions (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  -- Server-set by the trigger below; the client supplies neither it nor created_at.
  user_id    uuid not null references public.profiles (id) on delete cascade,
  -- Fixed allowlist (keeps the UI bounded + avoids arbitrary text in chat metadata).
  emoji      text not null check (emoji in ('👍', '❤️', '😂', '🔥', '💪', '🎉')),
  created_at timestamptz not null default now(),  -- UTC (§11)
  -- One of each emoji per user per message (a re-tap is a no-op conflict; toggling
  -- off is a delete).
  unique (message_id, user_id, emoji)
);

create index if not exists message_reactions_message_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;
-- Full row in the WAL so realtime DELETE events carry message_id/user_id/emoji (not
-- just the PK) — lets clients remove the exact reaction live.
alter table public.message_reactions replica identity full;

-- ── Server-set reactor (BEFORE INSERT) ───────────────────────────────────────
-- Force user_id = auth.uid() (a client can't forge a reactor) and block a banned
-- account. SECURITY INVOKER + pinned search_path; service_role / seed pass through.
create or replace function public.handle_message_reaction_insert()
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

  if exists (select 1 from public.profiles where id = auth.uid() and banned_at is not null) then
    raise exception 'banned' using errcode = 'P0001';  -- generic to the client (§4)
  end if;

  new.user_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists message_reactions_handle_insert on public.message_reactions;
create trigger message_reactions_handle_insert
  before insert on public.message_reactions
  for each row execute function public.handle_message_reaction_insert();

-- ── Policies (deny-by-default) ───────────────────────────────────────────────
-- Read / react: only a PARTICIPANT of the underlying message. The messages subquery
-- runs under the caller's own RLS (which already limits messages to its two parties),
-- and we additionally spell the participant test out — an outsider (§8) sees no
-- matching message row and is denied. No recursion: messages' policy never reads
-- message_reactions.
drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.messages m
       where m.id = message_id
         and (m.sender_id = auth.uid() or m.recipient_id = auth.uid())
    )
  );

drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
       where m.id = message_id
         and (m.sender_id = auth.uid() or m.recipient_id = auth.uid())
    )
  );

-- Delete: you may remove your OWN reaction (toggle off). No UPDATE policy.
drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.message_reactions to authenticated;
grant select on public.message_reactions to anon;  -- RLS -> 0 rows for anon

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Add to Supabase's realtime publication so reactions appear live; Realtime enforces
-- the SELECT policy, so each side only receives reactions on threads they're in.
-- Guarded: the publication exists on real Supabase but NOT in the local/CI shim.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
    ) then
      alter publication supabase_realtime add table public.message_reactions;
    end if;
  end if;
end
$$;
