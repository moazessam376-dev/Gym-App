-- 0007_function_hardening.sql
--
-- Hardening surfaced by the Supabase security advisor after Phase 2 deploy.
-- Idempotent (create or replace / revoke) so it can be re-pasted safely.

-- 1. Pin search_path on the two trigger functions from 0001. The repo's own
--    rls.md mandates `set search_path = ''` on functions; these two predated
--    that discipline. Bodies are unchanged — now() lives in pg_catalog (always
--    in scope), so an empty search_path is safe.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create or replace function public.enforce_profile_immutables()
returns trigger
language plpgsql
set search_path = ''
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

-- 2. is_coach_of is an INTERNAL RLS helper (the profiles SELECT policy calls it),
--    not a client-facing RPC. 0001 grants it to authenticated + service_role and
--    revokes PUBLIC, but a stray explicit `anon` grant existed on the live DB.
--    Remove it: anon never evaluates this policy (it is `to authenticated`), and
--    anon's auth.uid() is null so the function could only ever return false.
--    authenticated KEEPS execute — RLS planning requires it. No-op on a clean DB.
revoke execute on function public.is_coach_of(uuid) from anon;
