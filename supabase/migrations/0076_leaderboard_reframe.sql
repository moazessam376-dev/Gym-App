-- 0076_leaderboard_reframe.sql
--
-- Engagement E4 — make the boards rank by REAL progress and give coaches the self-rank card
-- athletes already have. Three changes (all carry forward the 0052 period windowing + privacy
-- discipline: SECURITY DEFINER, search_path='', field-allowlist, authenticated-only):
--   1. public_athlete_leaderboard — ADD @handle (the last board missing it). Otherwise identical.
--   2. public_coach_leaderboard — ADD median_goal_progress (the new rank key): the median of
--      client_goal_progress (0072) across the coach's roster, NULLs (non-rankable clients)
--      excluded. Counts (tracked/improved) are kept for display and still respect the period;
--      the median is all-time goal progress (a coach's overall track record). Floor stays at
--      >=3 tracked. Order by median desc (the vanity "% improved" is gone from the rank).
--   3. public_coach_my_rank(p_period) — NEW, mirrors public_athlete_my_rank (0057): the
--      caller-coach's own rank/total/median/counts, gated on opt-in + the >=3 floor (0 rows →
--      the UI shows a nudge).
--
-- client_goal_progress is service_role-only but these DEFINER fns are owned by the same role,
-- so they may call it. Idempotent: drop the changed-shape fns then recreate.

-- ── 1. Athlete board + @handle ───────────────────────────────────────────────
drop function if exists public.public_athlete_leaderboard(text, text, integer, integer);
create function public.public_athlete_leaderboard(
  p_sex    text default 'male',
  p_period text default 'all',
  p_limit  integer default 100,
  p_offset integer default 0
)
returns table (
  athlete_id      uuid,
  full_name       text,
  handle          text,
  avatar_media_id uuid,
  primary_goal    text,
  ffmi            numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.full_name, p.handle, p.avatar_media_id,
    ap.primary_goal::text,
    public.compute_ffmi(l.weight_grams, l.body_fat_bp, ap.height_cm) as ffmi
  from public.profiles p
  join public.athlete_profile ap on ap.user_id = p.id
  join lateral (
    select m.weight_grams, m.body_fat_bp
    from public.body_metrics m
    where m.user_id = p.id
      and m.verified_at is not null
      and m.body_fat_bp is not null
      and (
        p_period not in ('month', 'quarter')
        or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end)
      )
    order by m.measured_at desc, m.created_at desc
    limit 1
  ) l on true
  where ap.leaderboard_opt_in
    and ap.is_public
    and p.banned_at is null
    and ap.height_cm is not null
    and ap.sex is not null
    and ap.sex::text = p_sex
  order by ffmi desc nulls last, p.full_name asc
  limit greatest(0, least(coalesce(p_limit, 100), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.public_athlete_leaderboard(text, text, integer, integer) from public, anon;
grant execute on function public.public_athlete_leaderboard(text, text, integer, integer) to authenticated, service_role;

-- ── 2. Coach board + median goal-progress rank key ───────────────────────────
drop function if exists public.public_coach_leaderboard(text, integer, integer);
create function public.public_coach_leaderboard(
  p_period text default 'all',
  p_limit  integer default 100,
  p_offset integer default 0
)
returns table (
  coach_id             uuid,
  full_name            text,
  avatar_media_id      uuid,
  improved_clients     integer,
  tracked_clients      integer,
  median_goal_progress numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_coach as (
    select p.id
    from public.profiles p
    join public.coach_profile c on c.user_id = p.id
    where p.role = 'coach' and p.banned_at is null and c.is_public and c.leaderboard_opt_in
  ),
  roster as (
    select
      cl.coach_id, cl.id as client_id,
      b.body_fat_bp as baseline_bf, b.smm as baseline_smm,
      l.body_fat_bp as latest_bf,   l.smm as latest_smm,
      cnt.n as verified_n
    from (select p.id, p.coach_id from public.profiles p where p.coach_id in (select id from eligible_coach)) cl
    join lateral (
      select count(*)::int as n from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
        and (p_period not in ('month','quarter') or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end))
    ) cnt on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
        and (p_period not in ('month','quarter') or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end))
      order by m.measured_at asc, m.created_at asc limit 1
    ) b on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
        and (p_period not in ('month','quarter') or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end))
      order by m.measured_at desc, m.created_at desc limit 1
    ) l on true
  ),
  agg as (
    select
      r.coach_id,
      count(*) filter (where verified_n >= 2)::int as tracked_clients,
      count(*) filter (
        where verified_n >= 2 and (
          (latest_bf is not null and baseline_bf is not null and latest_bf < baseline_bf)
          or (latest_smm is not null and baseline_smm is not null and latest_smm > baseline_smm)
        )
      )::int as improved_clients
    from roster r group by r.coach_id
  ),
  med as (
    select r.coach_id, percentile_cont(0.5) within group (order by gp.gp) as median_gp
    from roster r
    join lateral (select public.client_goal_progress(r.client_id) as gp) gp on true
    where gp.gp is not null
    group by r.coach_id
  )
  select p.id, p.full_name, p.avatar_media_id, a.improved_clients, a.tracked_clients,
         round(m.median_gp::numeric, 1) as median_goal_progress
  from agg a
  join public.profiles p on p.id = a.coach_id
  left join med m on m.coach_id = a.coach_id
  where a.tracked_clients >= 3
  order by median_goal_progress desc nulls last, a.tracked_clients desc, p.full_name asc
  limit greatest(0, least(coalesce(p_limit, 100), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.public_coach_leaderboard(text, integer, integer) from public, anon;
grant execute on function public.public_coach_leaderboard(text, integer, integer) to authenticated, service_role;

-- ── 3. The coach's OWN rank (mirror of public_athlete_my_rank) ───────────────
create or replace function public.public_coach_my_rank(p_period text default 'all')
returns table (
  rank                 integer,
  total                integer,
  median_goal_progress numeric,
  tracked_clients      integer,
  improved_clients     integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_coach as (
    select p.id
    from public.profiles p
    join public.coach_profile c on c.user_id = p.id
    where p.role = 'coach' and p.banned_at is null and c.is_public and c.leaderboard_opt_in
  ),
  roster as (
    select
      cl.coach_id, cl.id as client_id,
      b.body_fat_bp as baseline_bf, b.smm as baseline_smm,
      l.body_fat_bp as latest_bf,   l.smm as latest_smm,
      cnt.n as verified_n
    from (select p.id, p.coach_id from public.profiles p where p.coach_id in (select id from eligible_coach)) cl
    join lateral (
      select count(*)::int as n from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
        and (p_period not in ('month','quarter') or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end))
    ) cnt on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
        and (p_period not in ('month','quarter') or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end))
      order by m.measured_at asc, m.created_at asc limit 1
    ) b on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
        and (p_period not in ('month','quarter') or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end))
      order by m.measured_at desc, m.created_at desc limit 1
    ) l on true
  ),
  agg as (
    select
      r.coach_id,
      count(*) filter (where verified_n >= 2)::int as tracked_clients,
      count(*) filter (
        where verified_n >= 2 and (
          (latest_bf is not null and baseline_bf is not null and latest_bf < baseline_bf)
          or (latest_smm is not null and baseline_smm is not null and latest_smm > baseline_smm)
        )
      )::int as improved_clients
    from roster r group by r.coach_id
  ),
  med as (
    select r.coach_id, percentile_cont(0.5) within group (order by gp.gp) as median_gp
    from roster r
    join lateral (select public.client_goal_progress(r.client_id) as gp) gp on true
    where gp.gp is not null
    group by r.coach_id
  ),
  board as (
    select a.coach_id, a.tracked_clients, a.improved_clients, round(m.median_gp::numeric, 1) as median_gp
    from agg a left join med m on m.coach_id = a.coach_id
    where a.tracked_clients >= 3
  )
  select
    (select count(*)::int from board b where coalesce(b.median_gp, -1000000) > coalesce(me.median_gp, -1000000)) + 1 as rank,
    (select count(*)::int from board) as total,
    me.median_gp, me.tracked_clients, me.improved_clients
  from board me
  where me.coach_id = auth.uid();
$$;
revoke all on function public.public_coach_my_rank(text) from public, anon;
grant execute on function public.public_coach_my_rank(text) to authenticated, service_role;
