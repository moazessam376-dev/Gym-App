-- 0034_chat_safety.sql
--
-- Phase 18 (Slice 1): chat safety core — message reporting + admin moderation +
-- account ban enforcement. Ships its table WITH RLS in the same migration
-- (deny-by-default, CLAUDE.md §2). Idempotent so it can be re-pasted into the SQL
-- editor.
--
-- Design notes / security:
--   * A participant reports a message ADDRESSED TO THEM. The reporter_id and the
--     reported_user_id are SERVER-SET (a BEFORE-INSERT trigger) — a client can't
--     forge who reported whom, nor report a message they can't see (§8 still hides
--     other tenants' DMs; the trigger reads the message under the caller's own RLS).
--   * Reports are append-only from the client: there is NO UPDATE/DELETE policy.
--     Status transitions (dismiss / ban / unban) are written ONLY by the service
--     role via moderate_message_report(), called inside an admin-checked Edge
--     Function (mirrors review_coach_application, 0011).
--   * Ban is a server-controlled flag on profiles (banned_at), immutable from the
--     client exactly like role/coach_id (the 0001 immutability trigger). A banned
--     user is blocked from SENDING messages by the existing send trigger.
--   * No SECURITY DEFINER functions are added here: the report trigger and the
--     moderate RPC are SECURITY INVOKER. The RPC is granted only to service_role,
--     so when the service-role Edge Function calls it, current_user stays
--     'service_role' → the immutability-trigger bypass fires and RLS is bypassed
--     (the review_coach_application pattern). This avoids the RPC-exposure advisor
--     warnings that a public SECURITY DEFINER function would raise.

-- ── profiles.banned_at — server-controlled account ban ───────────────────────
alter table public.profiles add column if not exists banned_at timestamptz;  -- null = not banned (UTC, §11)

-- Re-assert immutability (0001) WITH banned_at: role / coach_id / banned_at may
-- change only from the trusted server path (service_role). Full body reproduced
-- (create or replace) so the new guard ships in this migration.
create or replace function public.enforce_profile_immutables()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'service_role' then
    return new;  -- trusted server path may reassign role / coach / ban state
  end if;
  if new.role is distinct from old.role then
    raise exception 'role is immutable from client context';
  end if;
  if new.coach_id is distinct from old.coach_id then
    raise exception 'coach_id is immutable from client context';
  end if;
  if new.banned_at is distinct from old.banned_at then
    raise exception 'banned_at is immutable from client context';
  end if;
  return new;
end
$$;

-- Re-assert the send trigger (0012) WITH a ban check: a banned user cannot send.
-- SECURITY INVOKER + pinned search_path (unchanged); the ban read is the caller's
-- own profile row, which their RLS always permits. Full body reproduced.
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

-- ── message_reports — a participant flags a received message ──────────────────
create table if not exists public.message_reports (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references public.messages (id) on delete cascade,
  -- Both server-set by the trigger below; the client supplies neither.
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  reported_user_id uuid not null references public.profiles (id) on delete cascade,
  reason           text not null check (reason in ('harassment', 'spam', 'inappropriate', 'other')),
  note             text check (note is null or char_length(note) <= 1000),
  -- Immutable SNAPSHOT of the reported message, captured server-side at report time.
  -- This is what lets an admin moderate WITHOUT a blanket DM read override (§8: admins
  -- still cannot browse a thread) — they see only the specific reported line, and it
  -- can't be edited away after the fact.
  reported_body    text,
  -- Workflow state — flipped only by the service role (moderate_message_report).
  status           text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at       timestamptz not null default now(),  -- UTC (§11)
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  -- One report per message per reporter (anti-spam; a re-tap is a no-op conflict).
  unique (message_id, reporter_id)
);

-- Admin queue (open, oldest first) + the reporter's own lookups.
create index if not exists message_reports_open_idx
  on public.message_reports (created_at) where status = 'open';
create index if not exists message_reports_reporter_idx
  on public.message_reports (reporter_id);

alter table public.message_reports enable row level security;

-- ── Server-set reporter/reported (BEFORE INSERT) ─────────────────────────────
-- For an authenticated reporter: force reporter_id = auth.uid(), default the
-- workflow columns, and derive reported_user_id from the message's sender — but
-- only if the caller is the message's RECIPIENT (you report messages sent TO you).
-- SECURITY INVOKER: the message lookup runs under the caller's RLS, so an outsider
-- (who can't see the DM, §8) gets "not visible → cannot_report". service_role and
-- the seed path (auth.uid() null) pass through untouched (the seed sets ids itself).
create or replace function public.handle_message_report_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sender    uuid;
  v_recipient uuid;
begin
  if current_user = 'service_role' then
    return new;  -- trusted server path
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser (RLS bypassed); not a client request
  end if;

  -- The reporter is always the caller; the workflow columns are server-owned.
  new.reporter_id := auth.uid();
  new.status := 'open';
  new.reviewed_by := null;
  new.reviewed_at := null;

  -- You may only report a message ADDRESSED TO YOU; the reported user is its sender.
  -- Snapshot the body here too (admin sees this, not the live thread, §8).
  select sender_id, recipient_id, body
    into v_sender, v_recipient, new.reported_body
    from public.messages where id = new.message_id;
  if v_recipient is null or v_recipient <> auth.uid() then
    raise exception 'cannot_report_message' using errcode = 'P0001';
  end if;

  new.reported_user_id := v_sender;
  return new;
end;
$$;

drop trigger if exists message_reports_handle_insert on public.message_reports;
create trigger message_reports_handle_insert
  before insert on public.message_reports
  for each row execute function public.handle_message_report_insert();

-- ── Policies (deny-by-default) ───────────────────────────────────────────────
-- Read: the reporter (their own reports) or an admin (the moderation queue). The
-- REPORTED user is deliberately NOT allowed to read reports filed against them.
drop policy if exists message_reports_select on public.message_reports;
create policy message_reports_select on public.message_reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.current_app_role() = 'admin');

-- Create: as yourself, only 'open' and not pre-reviewed (the trigger forces these
-- too). The trigger additionally enforces the "addressed to you" rule.
drop policy if exists message_reports_insert on public.message_reports;
create policy message_reports_insert on public.message_reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and status = 'open'
    and reviewed_by is null
    and reviewed_at is null
  );

-- No UPDATE / DELETE policy on purpose: status transitions + the ban are written
-- ONLY by the service role (moderate_message_report).

grant select, insert on public.message_reports to authenticated;
grant select on public.message_reports to anon;  -- RLS -> 0 rows for anon

-- ── moderate_message_report — the only writer of report status + the ban ──────
-- service_role-only (SECURITY INVOKER → current_user stays service_role when the
-- admin-checked Edge Function calls it, so the profiles immutability trigger lets
-- banned_at change and RLS is bypassed). Verifies the reviewer is an admin.
--   dismiss → close with no action.
--   ban     → set the reported user's banned_at + mark the report actioned.
--   unban   → clear banned_at + mark the report actioned.
-- Generic errors (§4); idempotent (create or replace).
create or replace function public.moderate_message_report(
  p_report   uuid,
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
  if p_decision not in ('dismiss', 'ban', 'unban') then
    raise exception 'moderate_invalid' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_reviewer and role = 'admin'
  ) then
    raise exception 'moderate_invalid' using errcode = 'P0001';
  end if;

  select reported_user_id
    into v_user
    from public.message_reports
   where id = p_report
   for update;
  if not found then
    raise exception 'moderate_invalid' using errcode = 'P0001';
  end if;

  if p_decision = 'ban' then
    update public.profiles set banned_at = now() where id = v_user;
    update public.message_reports
       set status = 'actioned', reviewed_by = p_reviewer, reviewed_at = now()
     where id = p_report;
  elsif p_decision = 'unban' then
    update public.profiles set banned_at = null where id = v_user;
    update public.message_reports
       set status = 'actioned', reviewed_by = p_reviewer, reviewed_at = now()
     where id = p_report;
  else  -- dismiss
    update public.message_reports
       set status = 'dismissed', reviewed_by = p_reviewer, reviewed_at = now()
     where id = p_report;
  end if;
end;
$$;

revoke all on function public.moderate_message_report(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.moderate_message_report(uuid, text, uuid) to service_role;
