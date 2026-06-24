-- 0038_ban_appeals.sql
--
-- Phase 18 (Slice 3): a banned account can APPEAL its ban; an admin approves
-- (unban) or rejects. Completes the ban → blocked → appeal → unban arc. Ships its
-- table WITH RLS in the same migration (deny-by-default, CLAUDE.md §2). Idempotent
-- so it can be re-pasted into the SQL editor.
--
-- Design notes / security (mirrors message_reports in 0034):
--   * The appellant (user_id) and the workflow columns are SERVER-SET by a
--     BEFORE-INSERT trigger — a client can't forge who appealed nor pre-review it.
--   * A ban blocks SENDING/EDITING/REACTING only (those triggers check banned_at);
--     there is NO global ban gate, so a banned user can still INSERT an appeal. The
--     trigger additionally REQUIRES the caller to actually be banned (only banned
--     accounts appeal).
--   * Appeals are append-only from the client: there is NO UPDATE/DELETE policy.
--     Status transitions (approve / reject) + the unban are written ONLY by the
--     service role via resolve_ban_appeal(), inside an admin-checked Edge Function
--     (mirrors moderate_message_report, 0034).
--   * resolve_ban_appeal is SECURITY INVOKER and granted only to service_role, so
--     current_user stays 'service_role' when the Edge Function calls it → the
--     profiles immutability trigger lets banned_at change and RLS is bypassed.

-- ── ban_appeals — a banned account appeals its ban ───────────────────────────
create table if not exists public.ban_appeals (
  id          uuid primary key default gen_random_uuid(),
  -- Server-set by the trigger below; the client supplies neither this nor the
  -- workflow columns.
  user_id     uuid not null references public.profiles (id) on delete cascade,
  note        text not null check (char_length(note) between 1 and 1000),
  -- Workflow state — flipped only by the service role (resolve_ban_appeal).
  status      text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),  -- UTC (§11)
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz
);

-- One OPEN appeal per user (anti-spam; a re-submit while one is open is a no-op
-- conflict). Resolved appeals don't block a future appeal.
create unique index if not exists ban_appeals_one_open
  on public.ban_appeals (user_id) where status = 'open';
-- Admin queue (open, oldest first).
create index if not exists ban_appeals_open_idx
  on public.ban_appeals (created_at) where status = 'open';

alter table public.ban_appeals enable row level security;

-- ── Server-set appellant + workflow columns (BEFORE INSERT) ──────────────────
-- Force user_id = auth.uid(), default the workflow columns, and REQUIRE the
-- caller to be banned (only banned accounts appeal). SECURITY INVOKER; the ban
-- read is the caller's own profile row, which their RLS always permits.
-- service_role and the seed path (auth.uid() null) pass through untouched.
create or replace function public.handle_ban_appeal_insert()
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

  -- The appellant is always the caller; the workflow columns are server-owned.
  new.user_id := auth.uid();
  new.status := 'open';
  new.reviewed_by := null;
  new.reviewed_at := null;

  -- Only a banned account can appeal. Generic error to the client (§4).
  if not exists (
    select 1 from public.profiles where id = auth.uid() and banned_at is not null
  ) then
    raise exception 'not_banned' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists ban_appeals_handle_insert on public.ban_appeals;
create trigger ban_appeals_handle_insert
  before insert on public.ban_appeals
  for each row execute function public.handle_ban_appeal_insert();

-- ── Policies (deny-by-default) ───────────────────────────────────────────────
-- Read: the appellant (their own appeals) or an admin (the review queue).
drop policy if exists ban_appeals_select on public.ban_appeals;
create policy ban_appeals_select on public.ban_appeals
  for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin');

-- Create: as yourself, only 'open' and not pre-reviewed (the trigger forces these
-- too, and additionally enforces the "must be banned" rule).
drop policy if exists ban_appeals_insert on public.ban_appeals;
create policy ban_appeals_insert on public.ban_appeals
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'open'
    and reviewed_by is null
    and reviewed_at is null
  );

-- No UPDATE / DELETE policy on purpose: status transitions + the unban are written
-- ONLY by the service role (resolve_ban_appeal).

grant select, insert on public.ban_appeals to authenticated;
grant select on public.ban_appeals to anon;  -- RLS -> 0 rows for anon

-- ── resolve_ban_appeal — the only writer of appeal status + the unban ────────
-- service_role-only (SECURITY INVOKER → current_user stays service_role when the
-- admin-checked Edge Function calls it, so the profiles immutability trigger lets
-- banned_at change and RLS is bypassed). Verifies the reviewer is an admin.
--   approve → clear the appellant's banned_at + mark the appeal approved.
--   reject  → leave the ban in place + mark the appeal rejected.
-- Generic errors (§4); idempotent (create or replace).
create or replace function public.resolve_ban_appeal(
  p_appeal   uuid,
  p_decision text,
  p_reviewer uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'moderate_invalid' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_reviewer and role = 'admin'
  ) then
    raise exception 'moderate_invalid' using errcode = 'P0001';
  end if;

  select user_id
    into v_user
    from public.ban_appeals
   where id = p_appeal
   for update;
  if not found then
    raise exception 'moderate_invalid' using errcode = 'P0001';
  end if;

  if p_decision = 'approve' then
    update public.profiles set banned_at = null where id = v_user;
    update public.ban_appeals
       set status = 'approved', reviewed_by = p_reviewer, reviewed_at = now()
     where id = p_appeal;
  else  -- reject
    update public.ban_appeals
       set status = 'rejected', reviewed_by = p_reviewer, reviewed_at = now()
     where id = p_appeal;
  end if;
end;
$$;

revoke all on function public.resolve_ban_appeal(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_ban_appeal(uuid, text, uuid) to service_role;
