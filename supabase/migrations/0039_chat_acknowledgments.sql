-- 0039_chat_acknowledgments.sql
--
-- Phase 18 (Slice 3): the per-person disclaimer record. Before sending the first
-- message to a new person, the user must accept a hard disclaimer (abuse → the
-- WHOLE account is banned + legal action is supported if the other party requests
-- it). The acceptance is recorded here, once per (user, peer) pair, so the gate is
-- shown only on first contact. Ships its table WITH RLS in the same migration
-- (deny-by-default, CLAUDE.md §2). Idempotent.
--
-- Design notes / security:
--   * user_id is SERVER-SET by a BEFORE-INSERT trigger (the caller); the client
--     supplies only peer_id. The FK guarantees peer_id is a real profile.
--   * Append-only from the client: no UPDATE/DELETE policy. There is nothing
--     sensitive here, but keeping it server-owned matches the codebase convention.
--   * No banned check: a banned user can't message anyway, so an acknowledgment
--     from one is harmless and irrelevant.

-- ── chat_acknowledgments — "I accepted the chat terms before messaging X" ─────
create table if not exists public.chat_acknowledgments (
  -- Server-set by the trigger below; the client supplies only peer_id.
  user_id     uuid not null references public.profiles (id) on delete cascade,
  peer_id     uuid not null references public.profiles (id) on delete cascade,
  accepted_at timestamptz not null default now(),  -- UTC (§11)
  primary key (user_id, peer_id)
);

alter table public.chat_acknowledgments enable row level security;

-- ── Server-set user_id (BEFORE INSERT) ───────────────────────────────────────
create or replace function public.handle_chat_ack_insert()
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

  new.user_id := auth.uid();
  new.accepted_at := now();
  return new;
end;
$$;

drop trigger if exists chat_acknowledgments_handle_insert on public.chat_acknowledgments;
create trigger chat_acknowledgments_handle_insert
  before insert on public.chat_acknowledgments
  for each row execute function public.handle_chat_ack_insert();

-- ── Policies (deny-by-default) — own rows only ───────────────────────────────
drop policy if exists chat_acknowledgments_select on public.chat_acknowledgments;
create policy chat_acknowledgments_select on public.chat_acknowledgments
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists chat_acknowledgments_insert on public.chat_acknowledgments;
create policy chat_acknowledgments_insert on public.chat_acknowledgments
  for insert to authenticated
  with check (user_id = auth.uid());

-- No UPDATE / DELETE policy on purpose (append-only).

grant select, insert on public.chat_acknowledgments to authenticated;
grant select on public.chat_acknowledgments to anon;  -- RLS -> 0 rows for anon
