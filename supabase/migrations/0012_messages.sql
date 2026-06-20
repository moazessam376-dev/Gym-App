-- 0012_messages.sql
--
-- Phase 5: coach ⇄ client direct messages (CLAUDE.md §8). RLS limits every row to
-- its two parties (sender or recipient). The SERVER sets sender_id = auth.uid()
-- on insert (a BEFORE trigger; a client can't forge a sender), sends are
-- rate-limited, and you may only message your PAIRING (a coach → their own
-- client, a client → their own coach). Append-only: no UPDATE/DELETE policy.
-- Supabase Realtime respects RLS, so subscribers only receive their own rows.
-- Idempotent so it can be re-pasted into the SQL editor.

create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 4000),
  created_at   timestamptz not null default now(),  -- UTC (§11)
  constraint messages_no_self check (sender_id <> recipient_id)
);

-- Inbox / sent / rate-limit lookups.
create index if not exists messages_recipient_created_idx on public.messages (recipient_id, created_at);
create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at);

alter table public.messages enable row level security;

-- ── Server-set sender + rate limit (BEFORE INSERT) ───────────────────────────
-- For an authenticated sender: force sender_id = auth.uid() (never trust a
-- client value, §8) and cap sends per rolling window. service_role and the
-- seed/superuser path (auth.uid() null) pass through untouched. SECURITY INVOKER
-- so the rate-limit count runs under the sender's own RLS (their sent rows are
-- always visible to them). Pinned search_path; schema-qualified.
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

  -- The server owns the sender identity.
  new.sender_id := auth.uid();

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

drop trigger if exists messages_handle_insert on public.messages;
create trigger messages_handle_insert
  before insert on public.messages
  for each row execute function public.handle_message_insert();

-- ── Policies (deny-by-default) ───────────────────────────────────────────────
-- Read: only the two parties — no admin override (§8: privacy of DMs).
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

-- Send: as yourself (the trigger already forced this; re-checked here), to a
-- counterpart you're paired with — a coach to their own client, or a client to
-- their own coach. No self-messaging (also a table check).
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and recipient_id <> auth.uid()
    and (
      public.is_coach_of(recipient_id)        -- I am the recipient's coach
      or recipient_id = public.my_coach_id()  -- the recipient is my coach
    )
  );

-- No UPDATE / DELETE policy on purpose: messages are append-only.

grant select, insert on public.messages to authenticated;
grant select on public.messages to anon;  -- RLS -> 0 rows for anon

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Add the table to Supabase's realtime publication so clients get live inserts;
-- Realtime enforces the SELECT policy above, so each side only receives their own
-- messages. Guarded: the publication exists on real Supabase but NOT in the
-- local/CI plain-Postgres shim, so this is a no-op there.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;
  end if;
end
$$;
