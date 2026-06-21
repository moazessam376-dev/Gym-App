-- 0011_coach_applications.sql
--
-- Account & onboarding: a client applies to become a coach; an admin reviews and
-- (on approve) the user's role is flipped to 'coach'. Applying is a normal client
-- insert (RLS-gated). The status transition + the role flip are SERVER-SIDE ONLY
-- (CLAUDE.md §2/§5) — written only by review_coach_application running as the
-- service role inside an admin-checked Edge Function. Mirrors the invitations /
-- accept_invitation pattern (0005/0006/0008). Idempotent.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'application_status') then
    create type public.application_status as enum ('pending', 'approved', 'rejected');
  end if;
end
$$;

create table if not exists public.coach_applications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  status      public.application_status not null default 'pending',
  message     text,
  created_at  timestamptz not null default now(),  -- UTC (§11)
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null
);

create index if not exists coach_applications_user_id_idx on public.coach_applications (user_id);

-- At most one PENDING application per user (re-apply allowed after a decision).
create unique index if not exists coach_applications_one_pending_per_user
  on public.coach_applications (user_id)
  where status = 'pending';

alter table public.coach_applications enable row level security;

-- Read: your own applications; admins see all.
drop policy if exists coach_applications_select on public.coach_applications;
create policy coach_applications_select on public.coach_applications
  for select to authenticated
  using (user_id = auth.uid() or public.current_app_role() = 'admin');

-- Create: a CLIENT applies for THEMSELVES, only as 'pending', not pre-reviewed.
-- (Coaches/admins can't apply — current_app_role() must be 'client'.)
drop policy if exists coach_applications_insert on public.coach_applications;
create policy coach_applications_insert on public.coach_applications
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.current_app_role() = 'client'
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
  );

-- No UPDATE / DELETE policy on purpose: the review (status transition) and the
-- resulting role flip are written ONLY by the service role (§2).

grant select, insert on public.coach_applications to authenticated;
grant select on public.coach_applications to anon;  -- RLS -> 0 rows for anon

-- ── Review (the only writer of status + the role flip) ───────────────────────
-- service_role-only. Verifies the reviewer is an admin and the application is
-- pending. On approve: mark approved AND promote the applicant to coach (clearing
-- coach_id to satisfy profiles_coach_only_for_clients). On reject: mark rejected.
-- Runs as service_role so enforce_profile_immutables (0001) permits the role
-- change. Generic error on any bad input (§4). Idempotent (create or replace).
create or replace function public.review_coach_application(
  p_app      uuid,
  p_approve  boolean,
  p_reviewer uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  -- The reviewer must be an admin.
  if not exists (
    select 1 from public.profiles where id = p_reviewer and role = 'admin'
  ) then
    raise exception 'review_invalid' using errcode = 'P0001';
  end if;

  -- Lock the pending application; capture the applicant.
  select user_id
    into v_user_id
    from public.coach_applications
   where id = p_app
     and status = 'pending'
   for update;
  if not found then
    raise exception 'review_invalid' using errcode = 'P0001';
  end if;

  if p_approve then
    update public.coach_applications
       set status = 'approved', reviewed_at = now(), reviewed_by = p_reviewer
     where id = p_app;

    -- Promote: role -> coach, and clear coach_id (a coach has no coach). Only a
    -- 'client' is promotable; if they aren't a client anymore, fail safe.
    update public.profiles
       set role = 'coach', coach_id = null
     where id = v_user_id
       and role = 'client';
    if not found then
      raise exception 'review_invalid' using errcode = 'P0001';
    end if;
  else
    update public.coach_applications
       set status = 'rejected', reviewed_at = now(), reviewed_by = p_reviewer
     where id = p_app;
  end if;
end;
$$;

revoke all on function public.review_coach_application(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.review_coach_application(uuid, boolean, uuid) to service_role;
