-- 0001_profiles.sql
--
-- Identity, role, and tenancy. Per CLAUDE.md §2, RLS is enabled and every
-- policy ships in the SAME migration as the table — deny-by-default.

-- ── Enum ────────────────────────────────────────────────────────────────────
create type public.user_role as enum ('admin', 'coach', 'client');

-- ── Table ───────────────────────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        public.user_role not null default 'client',
  -- A client's assigned coach. NULL for admins, coaches, and unassigned clients.
  coach_id    uuid references public.profiles (id) on delete set null,
  full_name   text,
  created_at  timestamptz not null default now(),  -- stored UTC (§11)
  updated_at  timestamptz not null default now(),
  -- Only client rows may be assigned to a coach; keeps the tenancy model honest.
  constraint profiles_coach_only_for_clients
    check (coach_id is null or role = 'client')
);

create index profiles_coach_id_idx on public.profiles (coach_id);

alter table public.profiles enable row level security;

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- The app role (admin/coach/client) comes from a VERIFIED JWT custom claim
-- (`user_role`), never from client-supplied data (§5). In production this claim
-- is injected by a Supabase custom access-token hook (configured in Phase 1).
-- The RLS harness sets the same claim directly, so policies behave identically.
create or replace function public.current_app_role()
returns public.user_role
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'user_role', '')::public.user_role
$$;

-- "Is the current user the coach of <client>?" SECURITY DEFINER is REQUIRED:
-- it runs as the function owner and bypasses RLS on `profiles`, which breaks the
-- infinite-recursion cycle you'd otherwise hit when a child table's policy reads
-- `profiles` (Postgres: "infinite recursion detected in policy"). search_path is
-- pinned to '' and every name is schema-qualified to prevent search-path hijack.
create or replace function public.is_coach_of(client uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = client
      and p.coach_id = auth.uid()
  )
$$;

revoke all on function public.is_coach_of(uuid) from public;
grant execute on function public.is_coach_of(uuid) to authenticated, service_role;

-- ── Triggers ────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Block client-side privilege escalation / tenant-hopping: role and coach_id are
-- immutable except from the server (service_role). This is the enforcement point
-- for "writes that change ownership or role are server-side only" (§2).
create or replace function public.enforce_profile_immutables()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'service_role' then
    return new;  -- trusted server path may reassign role / coach
  end if;
  if new.role is distinct from old.role then
    raise exception 'role is immutable from client context';
  end if;
  if new.coach_id is distinct from old.coach_id then
    raise exception 'coach_id is immutable from client context';
  end if;
  return new;
end
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger profiles_enforce_immutables
  before update on public.profiles
  for each row execute function public.enforce_profile_immutables();

-- ── Policies (deny-by-default; explicit allows) ─────────────────────────────

-- Read: yourself, your own clients (coach), or anything (admin).
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_coach_of(id)
    or public.current_app_role() = 'admin'
  );

-- Create: only your OWN row, only as a plain client, with no self-assigned coach.
-- Elevating role or assigning a coach is server-side only.
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    id = auth.uid()
    and role = 'client'
    and coach_id is null
  );

-- Update: only your own row. role/coach_id immutability is enforced by trigger.
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Delete: admins only (account deletion is otherwise a server-side concern).
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.current_app_role() = 'admin');

-- ── Grants (RLS still gates the rows; grants only allow the statement) ───────
grant select on public.profiles to anon, authenticated;          -- anon: RLS -> 0 rows
grant insert, update, delete on public.profiles to authenticated;
