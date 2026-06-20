-- 0000_auth_shim.sql
--
-- LOCAL / CI ONLY. This file is NEVER applied to a real Supabase project.
--
-- It emulates the pieces the Supabase platform normally provides (the request
-- roles, the `auth` schema, and the `auth.uid()/role()/jwt()` helpers) so that
-- the REAL migration files (0001_*, 0002_*, ...) can run unmodified against a
-- plain PostgreSQL instance inside the RLS test harness. In production these
-- objects already exist, so the harness applies this shim first while
-- `supabase db push` / the dashboard never sees it.
--
-- Role creation is idempotent because roles are cluster-global and may already
-- exist from a previous run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- service_role mirrors Supabase: it BYPASSes RLS (server-side trust).
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  -- The role Supabase Auth assumes to run the custom access-token hook (0004).
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

-- The `auth` schema + a minimal `auth.users` so FKs (`references auth.users(id)`)
-- in the real migrations resolve. Production already has a much richer table.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

-- Claims helpers — these match Supabase's real implementations, which read the
-- per-request GUC `request.jwt.claims` that PostgREST sets on each connection.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'role'
$$;

-- Base grants mirroring Supabase defaults.
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- In real Supabase, service_role is granted privileges on public objects by the
-- platform (it BYPASSes RLS but still needs table GRANTs). Emulate that here so
-- the trusted server path works: anything created in public by the migration
-- runner is granted to service_role automatically.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
