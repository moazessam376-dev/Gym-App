-- 0003_profile_bootstrap.sql
--
-- Phase 1: profile creation becomes server-side. A trigger on auth.users creates
-- the profile, replacing the Phase 0 client self-insert — ownership/role writes
-- are server-side only (CLAUDE.md §2).

-- Create a default 'client' profile whenever a new auth user signs up.
-- SECURITY DEFINER so it can write public.profiles regardless of the caller.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'client')
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Clients no longer self-insert their profile; only the trigger (server-side)
-- creates it. Remove the Phase 0 self-insert policy and privilege.
drop policy if exists profiles_insert on public.profiles;
revoke insert on public.profiles from authenticated;

-- Tighten the immutability guard: block role/coach_id changes from CLIENT
-- contexts only (authenticated/anon). Trusted server roles (service_role) and the
-- migration/superuser path may still manage them — e.g. assigning a coach.
create or replace function public.enforce_profile_immutables()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role then
      raise exception 'role is immutable from client context';
    end if;
    if new.coach_id is distinct from old.coach_id then
      raise exception 'coach_id is immutable from client context';
    end if;
  end if;
  return new;
end
$$;
