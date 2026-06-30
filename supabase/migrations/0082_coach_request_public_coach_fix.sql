-- 0082_coach_request_public_coach_fix.sql
--
-- BUGFIX (coach-request funnel, broken since 0053). A signed-in unassigned client
-- requesting a public coach got a 400 (`request_invalid`) for EVERY coach. Root cause:
-- the BEFORE-INSERT trigger handle_coach_request_insert (0053, latest body 0065) is
-- SECURITY INVOKER and validated the target by reading the coach's row directly:
--
--     if not exists (select 1 from public.profiles where id = new.coach_id and role = 'coach')
--        or not public.is_public_profile(new.coach_id) then ... raise 'request_invalid';
--
-- That `exists` runs under the CALLER's RLS on public.profiles
-- (id = auth.uid() OR is_coach_of(id) OR admin). An unassigned client has NO read path
-- to an arbitrary coach's profiles row, so the exists is 0 -> `not exists(...)` is TRUE
-- -> request_invalid. (is_public_profile worked only because it's SECURITY DEFINER; the
-- bare role='coach' read is not.) This violates rls.md: "cross-table checks use a
-- SECURITY DEFINER helper so the policy/trigger doesn't re-enter another table's RLS."
--
-- Fix: a SECURITY DEFINER helper is_public_coach(uuid) that bypasses the caller's RLS
-- AND is stricter than is_public_profile (a public COACH specifically, not also a public
-- athlete). The trigger's target check becomes a single call to it. Check (a) — the
-- caller is an unassigned client — is unchanged: the client CAN read their own profiles
-- row, so that invoker read is fine. Pure DB fix; no edge-function redeploy. Idempotent.

-- ── is_public_coach — SECURITY DEFINER, used by the SECURITY INVOKER request trigger ──
create or replace function public.is_public_coach(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join public.coach_profile c on c.user_id = p.id
     where p.id = p_id
       and p.role = 'coach'
       and c.is_public
  )
$$;

-- The trigger is SECURITY INVOKER, so the CALLING client must hold EXECUTE. Mirror
-- is_public_profile's grants (0044): revoke from public/anon (stays advisor-0028-clean —
-- the by-name anon grant must be revoked explicitly), grant to authenticated + service_role.
revoke all on function public.is_public_coach(uuid) from public, anon;
grant execute on function public.is_public_coach(uuid) to authenticated, service_role;

-- ── Recreate the request trigger using the DEFINER helper ─────────────────────────────
-- Full body reproduced (CREATE OR REPLACE replaces the whole body — migrations.md),
-- carrying the 0065 per-client rolling-day cap. ONLY the target-coach check (b) changed.
create or replace function public.handle_coach_request_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recent integer;
begin
  if current_user = 'service_role' then
    return new;
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser (RLS bypassed); not a client request
  end if;

  new.client_id := auth.uid();
  new.client_name := (select full_name from public.profiles where id = auth.uid());
  new.status := 'pending';
  new.resolved_by := null;
  new.resolved_at := null;

  -- (a) Only an unassigned client may request a coach (generic error, §4). This reads the
  -- caller's OWN profiles row, which their RLS permits — so it stays a plain invoker read.
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'client' and coach_id is null
  ) then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  -- (b) The target must be a PUBLIC coach. Use the SECURITY DEFINER helper so this does
  -- NOT depend on the caller's (client's) RLS read access to the coach's profiles row.
  if not public.is_public_coach(new.coach_id) then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  -- Per-client cap: at most 10 requests per rolling 24h (counts cancelled rows too, so a
  -- cancel->re-insert loop that re-fires the coach-inbox notification is bounded) (L-2).
  select count(*) into v_recent
    from public.coach_requests
   where client_id = auth.uid()
     and created_at > now() - interval '24 hours';
  if v_recent >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
