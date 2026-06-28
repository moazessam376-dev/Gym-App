-- 0067_email_blocklist.sql
--
-- Security C-1 (ban-evasion via delete + re-register), defense-in-depth. The PRIMARY fix
-- is the account-delete Edge function refusing a banned caller (so a banned user can never
-- self-delete to free their email). This migration adds the secondary control GLM asked
-- for: an email blocklist consulted at signup, so that if a banned user's email is EVER
-- freed (e.g. a future admin force-delete of a banned account), it can't be re-registered.
--
-- email_blocklist is service-role-write-only (deny-by-default, no client policies). The
-- signup bootstrap (handle_new_user, AFTER INSERT on auth.users — SECURITY DEFINER) raises
-- when the new email is listed, which rolls back the auth.users insert and fails the
-- signup. The client sees a generic error (M-8 makes sign-up errors generic). Idempotent.
--
-- Population: there is no client/admin write surface yet (banned users are blocked from
-- account-delete, so today the table stays empty by design). A future admin force-delete
-- of a banned account inserts the email here (service role) before deleting the user.

-- ── email_blocklist — emails barred from (re-)registration ───────────────────
create table if not exists public.email_blocklist (
  email_lc   text primary key,                 -- lower(email)
  reason     text,
  blocked_at timestamptz not null default now()  -- UTC (§11)
);

alter table public.email_blocklist enable row level security;
-- No policies on purpose: deny-by-default. Only the service role (BYPASSRLS) reads/writes.
grant select on public.email_blocklist to anon, authenticated;  -- RLS -> 0 rows

-- ── handle_new_user: consult the blocklist before creating the profile ────────
-- Full body reproduced (migrations.md). Still SECURITY DEFINER + pinned search_path.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Barred email → fail the signup (rolls back the auth.users insert). Generic to client.
  if new.email is not null and exists (
    select 1 from public.email_blocklist where email_lc = lower(new.email)
  ) then
    raise exception 'email_blocked' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    'client',
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do nothing;  -- idempotent: never disturb an existing profile
  return new;
end
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
