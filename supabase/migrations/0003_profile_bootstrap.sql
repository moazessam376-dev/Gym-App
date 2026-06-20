-- 0003_profile_bootstrap.sql
--
-- Phase 1: move profile creation to the SERVER (CLAUDE.md §2). A trigger on
-- auth.users creates the public.profiles row at signup as a plain client. This
-- REPLACES Phase 0's client self-insert — an authenticated client can no longer
-- INSERT its own profile at all, so it can never self-assign role or coach_id at
-- creation time. Role/ownership are set only by the trusted server path
-- (this trigger today; service_role / Edge Functions later).

-- ── Bootstrap function ──────────────────────────────────────────────────────
-- SECURITY DEFINER so it writes profiles as the function owner (the server's
-- behalf), not as the just-created user. search_path pinned to '' and every name
-- schema-qualified to block search-path hijack — same discipline as is_coach_of
-- in 0001.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'client')
  on conflict (id) do nothing;  -- idempotent: never disturb an existing profile
  return new;
end
$$;

-- Defense in depth: this is only ever invoked by the trigger below, never called
-- directly by a client.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Idempotent: drop any prior trigger of this name so the migration can be safely
-- re-applied (e.g. re-pasted into the SQL editor). No-op in the fresh harness.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Retire the Phase 0 client self-insert path ──────────────────────────────
-- Profiles are created by the trigger above now. Dropping the INSERT policy
-- means deny-by-default reclaims inserts: an authenticated client cannot insert
-- a profile row at all (so cannot smuggle in role='admin' or a coach_id either).
drop policy if exists profiles_insert on public.profiles;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Any account created before this migration (e.g. during Slice A testing) has no
-- profile yet. Give each one a default client profile so every user is consistent.
-- (No-op in the from-scratch harness, where auth.users is empty at migrate time.)
insert into public.profiles (id, role)
select u.id, 'client'
from auth.users u
on conflict (id) do nothing;
