-- 0081_coach_performance_trends.sql
--
-- Engagement E5 — weekly roster-activity buckets so the Performance tab can show real
-- sparklines + week-over-week deltas (it was flat snapshots before). Returns the last N
-- weeks of: sessions_logged (completed sessions across the coach's roster) and active_clients
-- (distinct clients who completed ≥1 session that week). Honest, computable signals — we
-- deliberately DON'T fake a weekly "adherence %"/median (those aren't meaningfully weekly).
--
-- SECURITY DEFINER so it can read across the roster in one pass, fenced HARD by
-- p.coach_id = auth.uid() (a non-coach's auth.uid() coaches nobody → 0 rows). Idempotent.

create or replace function public.coach_performance_trends(p_weeks integer default 8)
returns table (
  week_start      date,
  sessions_logged integer,
  active_clients  integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select greatest(1, least(coalesce(p_weeks, 8), 26)) as n,
           date_trunc('week', (now() at time zone 'utc')::date)::date as this_week
  ),
  weeks as (
    select generate_series(b.this_week - ((b.n - 1) * 7), b.this_week, interval '7 days')::date as wk
    from bounds b
  ),
  s as (
    select date_trunc('week', ws.session_date)::date as wk, ws.user_id, count(*)::int as n
    from public.workout_sessions ws
    join public.profiles p on p.id = ws.user_id
    cross join bounds b
    where p.coach_id = auth.uid()
      and ws.status = 'completed'
      and ws.session_date >= b.this_week - ((b.n - 1) * 7)
    group by 1, 2
  )
  select
    w.wk,
    coalesce((select sum(s.n)::int from s where s.wk = w.wk), 0) as sessions_logged,
    coalesce((select count(distinct s.user_id)::int from s where s.wk = w.wk), 0) as active_clients
  from weeks w
  order by w.wk asc;
$$;
revoke all on function public.coach_performance_trends(integer) from public, anon;
grant execute on function public.coach_performance_trends(integer) to authenticated, service_role;
