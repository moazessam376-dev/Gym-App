-- 0016_completion_logging.sql
--
-- The completion-logging primitive: lets a CLIENT record "I did this workout"
-- (a session) and "I did these sets" (per-set detail). This is the missing verb
-- the whole gamified UI hangs off — daily adherence ring, streaks, and the
-- coach-cohort leaderboard are all derived from these two tables.
--
-- Same deny-by-default tenancy as the rest of the app (§2): a client owns their
-- own sessions/sets (user_id = auth.uid()); their coach can read them
-- (is_coach_of); admin can read. Logging is an owner-scoped, low-risk write
-- exactly like progress_entries — NOT an ownership/role/billing change — so it is
-- client-allowed via RLS, no Edge Function needed. The only cross-tenant read is
-- the leaderboard, which goes through a SECURITY DEFINER function fenced to the
-- caller's own clients. Money/weight discipline (money.md): actual load is
-- integer grams, never a float. Idempotent so it can be re-pasted.

-- ── Enum ──────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'session_status') then
    create type public.session_status as enum ('in_progress', 'completed', 'skipped');
  end if;
end
$$;

-- ── workout_sessions: the streak / adherence unit (client-owned) ──────────────
create table if not exists public.workout_sessions (
  id           uuid primary key default gen_random_uuid(),
  -- The owner (a client). This is the `user_id = auth.uid()` column from §2.
  user_id      uuid not null references public.profiles (id) on delete cascade,
  -- Denormalized plan link (survives a day delete) for cheap leaderboard/ring joins.
  plan_id      uuid references public.plans (id) on delete set null,
  -- The planned day this session fulfills. NULL = an ad-hoc / unplanned workout.
  day_id       uuid references public.plan_days (id) on delete set null,
  -- The calendar day the work happened, for streaks/rings/leaderboards. The app
  -- passes the device-local date; the default is the UTC date as a fallback (§11).
  session_date date not null default (now() at time zone 'utc')::date,
  status       public.session_status not null default 'completed',
  completed_at timestamptz,                          -- UTC; set when status -> completed
  note         text,
  created_at   timestamptz not null default now(),   -- UTC (§11)
  updated_at   timestamptz not null default now(),
  -- One session per planned day per date (idempotent "mark done"). NULL day_id is
  -- distinct in a unique index, so repeat ad-hoc sessions on a date are allowed.
  unique (user_id, day_id, session_date)
);
create index if not exists workout_sessions_user_date_idx
  on public.workout_sessions (user_id, session_date);
create index if not exists workout_sessions_plan_id_idx on public.workout_sessions (plan_id);
create index if not exists workout_sessions_day_id_idx on public.workout_sessions (day_id);

alter table public.workout_sessions enable row level security;

drop trigger if exists workout_sessions_set_updated_at on public.workout_sessions;
create trigger workout_sessions_set_updated_at
  before update on public.workout_sessions
  for each row execute function public.set_updated_at();

-- Read: the owning client, their coach, or an admin (mirrors progress_entries).
drop policy if exists workout_sessions_select on public.workout_sessions;
create policy workout_sessions_select on public.workout_sessions
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_of(user_id)
    or public.current_app_role() = 'admin'
  );

-- Create: only rows you OWN. The server never trusts a client-supplied owner.
drop policy if exists workout_sessions_insert on public.workout_sessions;
create policy workout_sessions_insert on public.workout_sessions
  for insert to authenticated
  with check (user_id = auth.uid());

-- Update: the owner or their coach (lets a coach annotate). The owner column can't
-- be moved to a user you aren't / don't coach, because the new value must still pass.
drop policy if exists workout_sessions_update on public.workout_sessions;
create policy workout_sessions_update on public.workout_sessions
  for update to authenticated
  using (user_id = auth.uid() or public.is_coach_of(user_id))
  with check (user_id = auth.uid() or public.is_coach_of(user_id));

-- Delete: the owner only.
drop policy if exists workout_sessions_delete on public.workout_sessions;
create policy workout_sessions_delete on public.workout_sessions
  for delete to authenticated
  using (user_id = auth.uid());

grant select on public.workout_sessions to anon, authenticated;   -- anon: RLS -> 0 rows
grant insert, update, delete on public.workout_sessions to authenticated;

-- ── Helpers: resolve a set log's tenancy up to its session ────────────────────
-- exercise_set_logs hold only session_id, so they need helpers that resolve up to
-- the owning session. SECURITY DEFINER (like is_coach_of / can_read_day) so the
-- policy doesn't re-enter workout_sessions' RLS and recurse. Pinned search_path;
-- every name schema-qualified.
create or replace function public.can_read_session(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workout_sessions s
    where s.id = p_session
      and (
        s.user_id = auth.uid()
        or public.is_coach_of(s.user_id)
        or public.current_app_role() = 'admin'
      )
  )
$$;

create or replace function public.can_write_session(p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workout_sessions s
    where s.id = p_session and s.user_id = auth.uid()
  )
$$;

revoke all on function public.can_read_session(uuid)  from public;
revoke all on function public.can_write_session(uuid) from public;
revoke execute on function public.can_read_session(uuid)  from anon;
revoke execute on function public.can_write_session(uuid) from anon;
grant execute on function public.can_read_session(uuid)  to authenticated, service_role;
grant execute on function public.can_write_session(uuid) to authenticated, service_role;

-- ── exercise_set_logs: per-set detail (resolves tenancy up to the session) ────
create table if not exists public.exercise_set_logs (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.workout_sessions (id) on delete cascade,
  -- Which planned exercise this fulfills. NULL = an ad-hoc / extra movement.
  plan_exercise_id uuid references public.plan_exercises (id) on delete set null,
  -- Display-name SNAPSHOT (same pattern as plan_exercises.exercise_name), so the
  -- log renders without re-reading the plan and is stable against later edits.
  exercise_name    text not null,
  set_index        integer not null check (set_index >= 0),
  reps_done        integer check (reps_done is null or reps_done >= 0),
  load_grams       integer check (load_grams is null or load_grams >= 0),  -- integer, never float
  is_completed     boolean not null default true,
  note             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (session_id, plan_exercise_id, set_index)
);
create index if not exists exercise_set_logs_session_id_idx on public.exercise_set_logs (session_id);
create index if not exists exercise_set_logs_plan_exercise_id_idx
  on public.exercise_set_logs (plan_exercise_id);

alter table public.exercise_set_logs enable row level security;

drop trigger if exists exercise_set_logs_set_updated_at on public.exercise_set_logs;
create trigger exercise_set_logs_set_updated_at
  before update on public.exercise_set_logs
  for each row execute function public.set_updated_at();

drop policy if exists exercise_set_logs_select on public.exercise_set_logs;
create policy exercise_set_logs_select on public.exercise_set_logs
  for select to authenticated using (public.can_read_session(session_id));
drop policy if exists exercise_set_logs_insert on public.exercise_set_logs;
create policy exercise_set_logs_insert on public.exercise_set_logs
  for insert to authenticated with check (public.can_write_session(session_id));
drop policy if exists exercise_set_logs_update on public.exercise_set_logs;
create policy exercise_set_logs_update on public.exercise_set_logs
  for update to authenticated
  using (public.can_write_session(session_id)) with check (public.can_write_session(session_id));
drop policy if exists exercise_set_logs_delete on public.exercise_set_logs;
create policy exercise_set_logs_delete on public.exercise_set_logs
  for delete to authenticated using (public.can_write_session(session_id));

grant select on public.exercise_set_logs to anon, authenticated;  -- anon: RLS -> 0 rows
grant insert, update, delete on public.exercise_set_logs to authenticated;

-- ── Adherence view: sets done vs planned, per session ─────────────────────────
-- SECURITY INVOKER (security_invoker = true) so the base-table RLS of the QUERYING
-- user applies — a client sees only their own sessions, a coach their clients'.
-- Without it a view runs with the owner's rights and would bypass RLS. The
-- sets_planned subquery reads plan_exercises, which the same user can already read
-- for their own (published) plan. Views aren't base tables, so the "RLS enabled"
-- invariant doesn't (and needn't) cover them.
drop view if exists public.v_session_adherence;
create view public.v_session_adherence with (security_invoker = true) as
  select
    s.id           as session_id,
    s.user_id,
    s.plan_id,
    s.day_id,
    s.session_date,
    s.status,
    coalesce(count(esl.id) filter (where esl.is_completed), 0) as sets_done,
    coalesce(count(esl.id), 0)                                 as sets_logged,
    coalesce(
      (select sum(pe.sets) from public.plan_exercises pe where pe.day_id = s.day_id),
      0
    )::bigint as sets_planned
  from public.workout_sessions s
  left join public.exercise_set_logs esl on esl.session_id = s.id
  group by s.id;

grant select on public.v_session_adherence to anon, authenticated;

-- ── current_streak: consecutive completed days ending today/yesterday ─────────
-- SECURITY INVOKER: filters to p_user and relies on workout_sessions RLS, so a
-- coach calling it for their client is gated exactly like a direct read.
create or replace function public.current_streak(p_user uuid default auth.uid())
returns integer
language sql
stable
set search_path = ''
as $$
  with d as (
    select distinct session_date as sd
    from public.workout_sessions
    where user_id = p_user and status = 'completed'
  ),
  -- Gaps-and-islands: consecutive dates share (sd - row_number()).
  grp as (
    select sd, (sd - (row_number() over (order by sd))::int) as g
    from d
  ),
  islands as (
    select max(sd) as end_sd, count(*)::int as len
    from grp
    group by g
  )
  -- The "current" streak is the island reaching today (1-day grace for tz/late nights).
  select coalesce(
    (select len from islands
      where end_sd >= (now() at time zone 'utc')::date - 1
      order by len desc
      limit 1),
    0
  );
$$;

revoke all on function public.current_streak(uuid) from public;
revoke execute on function public.current_streak(uuid) from anon;
grant execute on function public.current_streak(uuid) to authenticated, service_role;

-- ── coach_leaderboard: weekly cohort ranking, fenced to the caller's clients ──
-- SECURITY DEFINER so it can aggregate across many clients' rows in one pass, but
-- it NEVER returns a row whose coach_id <> auth.uid() — the WHERE clause is the
-- leak-proof tenancy fence. A non-coach caller is rejected; anon can't execute it
-- (no grant). This is the only cross-tenant read path in this migration.
create or replace function public.coach_leaderboard(p_week_start date)
returns table (client_id uuid, full_name text, sessions_done integer, sets_done integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() is distinct from 'coach' then
    raise exception 'not_a_coach' using errcode = 'P0001';
  end if;

  return query
    select
      p.id,
      p.full_name,
      count(distinct s.id)::int,
      coalesce(count(esl.id), 0)::int
    from public.profiles p
    left join public.workout_sessions s
      on s.user_id = p.id
     and s.status = 'completed'
     and s.session_date >= p_week_start
     and s.session_date <  p_week_start + 7
    left join public.exercise_set_logs esl
      on esl.session_id = s.id and esl.is_completed
    where p.coach_id = auth.uid()      -- HARD fence: only the caller's own clients
    group by p.id, p.full_name;
end;
$$;

revoke all on function public.coach_leaderboard(date) from public, anon;
grant execute on function public.coach_leaderboard(date) to authenticated, service_role;
