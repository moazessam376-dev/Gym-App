-- 0065_coach_request_cap.sql
--
-- Security L-2 (coach-request flooding). coach_requests (0053) had no per-client cap, and
-- cancel→re-insert frees the one-open partial-unique index, so a client could re-fire the
-- coach-inbox notification (tg_notify_on_coach_request) repeatedly, and/or fan a request
-- out to every public coach. Add a per-client rolling-day cap (10/24h, counting ALL
-- inserts incl. cancelled ones so the cancel-loop is covered) inside the existing
-- BEFORE-INSERT trigger. SECURITY INVOKER + pinned search_path unchanged. Full body
-- reproduced (migrations.md). Idempotent.

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

  -- Only an unassigned client may request a coach (generic error, §4).
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'client' and coach_id is null
  ) then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  -- The target must be a PUBLIC coach (the discover directory is the only entry point).
  if not exists (
    select 1 from public.profiles where id = new.coach_id and role = 'coach'
  ) or not public.is_public_profile(new.coach_id) then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  -- Per-client cap: at most 10 requests per rolling 24h (counts cancelled rows too, so a
  -- cancel→re-insert loop that re-fires the coach-inbox notification is bounded) (L-2).
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
