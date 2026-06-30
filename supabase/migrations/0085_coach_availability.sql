-- 0085_coach_availability.sql
--
-- Calendly-style recurring weekly availability. Instead of the coach adding every slot by
-- hand, they set a weekly WINDOW per weekday (start + end, local minutes); clients then book
-- a TIME inside that window at their CHOSEN duration (15/30/45/60), computed client-side,
-- minus already-booked. This ADDS to the existing ad-hoc `coach_call_slots` (one-off slots
-- outside working hours) — both coexist:
--   * slot booking      → calls.slot_id set (validated by assert_bookable_slot, 0083).
--   * working-hours book → calls.slot_id NULL + client-sent scheduled_at + duration
--                          (validated by assert_bookable_time below).
-- The coach still APPROVES every request, so the window is a UX guide; double-booking the
-- exact same start is guarded server-side. Times are the user's LOCAL tz on both sides
-- (single-region pilot); the window is stored as minutes-from-midnight, weekday 0=Sunday.

-- ── coach_availability — one weekly window per weekday ──────────────────────────
create table if not exists public.coach_availability (
  coach_id     uuid     not null references public.profiles (id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),       -- 0=Sun (JS getDay)
  start_minute integer  not null check (start_minute between 0 and 1439),
  end_minute   integer  not null check (end_minute between 1 and 1440),
  updated_at   timestamptz not null default now(),
  primary key (coach_id, weekday),
  constraint coach_availability_window check (end_minute > start_minute)
);

alter table public.coach_availability enable row level security;

drop trigger if exists coach_availability_set_updated_at on public.coach_availability;
create trigger coach_availability_set_updated_at
  before update on public.coach_availability
  for each row execute function public.set_updated_at();

-- SELECT: the owning coach + their clients (for the booking sheet) + admin.
drop policy if exists coach_availability_select on public.coach_availability;
create policy coach_availability_select on public.coach_availability
  for select to authenticated
  using (coach_id = auth.uid() or coach_id = public.my_coach_id() or public.current_app_role() = 'admin');

-- INSERT/UPDATE/DELETE: a coach manages only their own weekly window.
drop policy if exists coach_availability_insert on public.coach_availability;
create policy coach_availability_insert on public.coach_availability
  for insert to authenticated
  with check (coach_id = auth.uid() and public.current_app_role() = 'coach');
drop policy if exists coach_availability_update on public.coach_availability;
create policy coach_availability_update on public.coach_availability
  for update to authenticated
  using (coach_id = auth.uid()) with check (coach_id = auth.uid());
drop policy if exists coach_availability_delete on public.coach_availability;
create policy coach_availability_delete on public.coach_availability
  for delete to authenticated
  using (coach_id = auth.uid());

grant select, insert, update, delete on public.coach_availability to authenticated;
grant select on public.coach_availability to anon;  -- RLS -> 0 rows for anon

-- ── Exact-start double-booking guard for working-hours (slotless) bookings ─────
-- The 0083 slot guard covers slot bookings; this covers slotless time bookings: at most one
-- active client_request per (coach, exact start). Overlapping different-start times are caught
-- by the coach at approval (low-concurrency pilot).
create unique index if not exists calls_one_active_per_coach_time
  on public.calls (coach_id, scheduled_at)
  where slot_id is null and origin = 'client_request' and status in ('pending', 'accepted', 'in_progress');

-- ── assert_bookable_time — SECURITY DEFINER, used by the SECURITY INVOKER insert trigger.
-- Validates a slotless working-hours booking: the target is the caller's coach, the time is
-- in the future, and the duration is sane. (Within-window is enforced client-side + by coach
-- approval, not here — the coach is the gate.)
create or replace function public.assert_bookable_time(p_coach uuid, p_start timestamptz, p_duration integer)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_start is null or p_start <= now() then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;
  if p_duration is null or p_duration < 5 or p_duration > 240 then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_coach and role = 'coach') then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.assert_bookable_time(uuid, timestamptz, integer) from public, anon;
grant execute on function public.assert_bookable_time(uuid, timestamptz, integer) to authenticated, service_role;

-- ── Recreate handle_call_insert: the client path now accepts EITHER a slot_id (ad-hoc slot)
-- OR a slotless working-hours booking (client-sent scheduled_at + duration). Full body
-- reproduced (CREATE OR REPLACE replaces the whole body — migrations.md); only the client
-- branch's slot/time split is new. Coach ad-hoc path unchanged.
create or replace function public.handle_call_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role   public.user_role;
  v_slot   public.coach_call_slots;
  v_recent integer;
begin
  if current_user = 'service_role' then
    return new;
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser
  end if;

  v_role := public.current_app_role();

  new.resolved_by := null;
  new.resolved_at := null;
  new.started_at := null;
  new.ended_at := null;
  new.room_name := null;
  new.room_url := null;
  new.transaction_id := null;
  new.reminder_sent_at := null;
  new.provider := 'jitsi';

  if v_role = 'client' then
    new.origin := 'client_request';
    new.client_id := auth.uid();
    new.coach_id := public.my_coach_id();
    new.status := 'pending';
    new.client_name := (select full_name from public.profiles where id = auth.uid());
    if new.coach_id is null then
      raise exception 'request_invalid' using errcode = 'P0001';
    end if;

    if new.slot_id is not null then
      -- Ad-hoc slot booking (0083): validate + snapshot from the slot.
      v_slot := public.assert_bookable_slot(new.slot_id, new.coach_id);
      new.scheduled_at := v_slot.starts_at;
      new.duration_minutes := v_slot.duration_minutes;
      new.expires_at := v_slot.starts_at;
    else
      -- Working-hours booking: trust the client-sent time + duration (coach approves).
      perform public.assert_bookable_time(new.coach_id, new.scheduled_at, new.duration_minutes);
      new.expires_at := new.scheduled_at;
    end if;

    -- Per-client rolling-24h request cap (mirror 0065).
    select count(*) into v_recent
      from public.calls
     where client_id = auth.uid() and origin = 'client_request'
       and created_at > now() - interval '24 hours';
    if v_recent >= 20 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;

  elsif v_role = 'coach' then
    new.origin := 'coach_adhoc';
    new.coach_id := auth.uid();
    new.status := 'ringing';
    new.slot_id := null;
    new.scheduled_at := now();
    new.expires_at := now() + interval '2 minutes';
    new.client_name := (select full_name from public.profiles where id = new.client_id);
    if not public.is_coach_of(new.client_id) then
      raise exception 'request_invalid' using errcode = 'P0001';
    end if;
    select count(*) into v_recent
      from public.calls
     where coach_id = auth.uid() and client_id = new.client_id and origin = 'coach_adhoc'
       and created_at > now() - interval '1 hour';
    if v_recent >= 10 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;

  else
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
-- trigger already exists from 0083; CREATE OR REPLACE keeps it bound.

-- ── coach_booked_times — a field-allowlist RPC so a client can grey out already-taken times
-- in the booking sheet WITHOUT seeing who booked them (calls_select hides other clients' rows).
-- Returns only the busy start-times + durations of the coach's upcoming active calls; callable
-- by the coach themselves or any of their clients (rls.md field-allowlist pattern).
create or replace function public.coach_booked_times(p_coach uuid)
returns table (scheduled_at timestamptz, duration_minutes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.scheduled_at, c.duration_minutes
    from public.calls c
   where c.coach_id = p_coach
     and (p_coach = auth.uid() or p_coach = public.my_coach_id())
     and c.status in ('pending', 'accepted', 'in_progress')
     and c.scheduled_at is not null
     and c.scheduled_at > now();
$$;
revoke all on function public.coach_booked_times(uuid) from public, anon;
grant execute on function public.coach_booked_times(uuid) to authenticated, service_role;
