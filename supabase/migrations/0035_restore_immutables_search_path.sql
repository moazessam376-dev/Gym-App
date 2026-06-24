-- 0035_restore_immutables_search_path.sql
--
-- Follow-up to 0034. That migration re-created enforce_profile_immutables (to add
-- the banned_at guard) by copying the 0001 body, which inadvertently dropped the
-- `set search_path = ''` that 0007_function_hardening had pinned on it — flagged by
-- the security advisor (function_search_path_mutable). Re-assert the function WITH
-- the pinned search_path. The body only touches NEW/OLD + current_user (no
-- schema-qualified table access), so an empty search_path is safe (matches 0007).
-- Idempotent.
create or replace function public.enforce_profile_immutables()
returns trigger
language plpgsql
set search_path = ''
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
