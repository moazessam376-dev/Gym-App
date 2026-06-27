-- 0052_leaderboard_period_and_rank.sql
--
-- Slice G1 — period-aware public leaderboards + an athlete self-rank RPC.
--
-- Extends the Phase 20 (0045) boards so the UI can offer a period toggle and pin the
-- viewer's own rank:
--   * A `p_period` window ('all' | 'month' | 'quarter') restricts the ranking to verified
--     readings MEASURED within the window — an "active this period" board. 'all' preserves
--     the original latest-ever behavior. month = last 30 days, quarter = last 90 days.
--     Within the window we still take each athlete's LATEST in-window verified reading
--     (consistent with the all-time board's "latest ever"), so the number is their current
--     standing for that window, not a cherry-picked best.
--   * public_athlete_my_rank(p_sex, p_period): the CALLER's own standing on the athlete
--     board — 1 + the count of opted-in public athletes (same sex + window) whose FFMI is
--     strictly higher — so the app can pin a "You · #N of M" row even for athletes outside
--     the loaded top-100 page.
--
-- Privacy discipline is identical to 0045: SECURITY DEFINER + search_path='' + a
-- field-allowlist SELECT (FFMI / counts only — NEVER the weight/body-fat/height inputs,
-- never sex). The self-rank RPC returns ONLY the caller's own number (their own data);
-- no other athlete's row leaves the function even though it counts across the board
-- internally. Granted to `authenticated` only (never anon). auth.uid() survives SECURITY
-- DEFINER (it is read from the request JWT, not the executing role). Idempotent:
-- drop the old 3-arg signatures, then create the period-aware versions (a differing arg
-- list would otherwise leave a stale overload that makes PostgREST .rpc() ambiguous).

-- ── 1. Top Athletes board (period-aware, FFMI-ranked) ────────────────────────
drop function if exists public.public_athlete_leaderboard(text, integer, integer);

-- Param order keeps p_sex FIRST so existing positional callers — public_athlete_leaderboard('male')
-- / ('female') — keep selecting by sex; p_period is appended (the app passes all args by name).
create or replace function public.public_athlete_leaderboard(
  p_sex    text default 'male',
  p_period text default 'all',
  p_limit  integer default 100,
  p_offset integer default 0
)
returns table (
  athlete_id      uuid,
  full_name       text,
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
    p.id,
    p.full_name,
    p.avatar_media_id,
    ap.primary_goal::text,
    round(
      ((l.weight_grams / 1000.0) * (1 - l.body_fat_bp / 10000.0))
        / power(ap.height_cm / 100.0, 2),
      1
    ) as ffmi
  from public.profiles p
  join public.athlete_profile ap on ap.user_id = p.id
  -- Latest COACH-VERIFIED reading (with a body-fat number) WITHIN the period window.
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

-- ── 2. Top Coaches board (period-aware verified client outcomes — counts only) ─
drop function if exists public.public_coach_leaderboard(integer, integer);

create or replace function public.public_coach_leaderboard(
  p_period text default 'all',
  p_limit  integer default 100,
  p_offset integer default 0
)
returns table (
  coach_id         uuid,
  full_name        text,
  avatar_media_id  uuid,
  improved_clients integer,
  tracked_clients  integer
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
    where p.role = 'coach'
      and p.banned_at is null
      and c.is_public
      and c.leaderboard_opt_in
  ),
  roster as (
    select
      cl.coach_id,
      b.body_fat_bp as baseline_bf, b.smm as baseline_smm,
      l.body_fat_bp as latest_bf,   l.smm as latest_smm,
      cnt.n as verified_n
    from (
      select p.id, p.coach_id
      from public.profiles p
      where p.coach_id in (select id from eligible_coach)
    ) cl
    -- All three laterals share the same period window so baseline / latest / count agree.
    join lateral (
      select count(*)::int as n
      from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
        and (
          p_period not in ('month', 'quarter')
          or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end)
        )
    ) cnt on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
      from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
        and (
          p_period not in ('month', 'quarter')
          or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end)
        )
      order by m.measured_at asc, m.created_at asc
      limit 1
    ) b on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
      from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
        and (
          p_period not in ('month', 'quarter')
          or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end)
        )
      order by m.measured_at desc, m.created_at desc
      limit 1
    ) l on true
  ),
  agg as (
    select
      r.coach_id,
      count(*) filter (where verified_n >= 2)::int as tracked_clients,
      count(*) filter (
        where verified_n >= 2
          and (
            (latest_bf is not null and baseline_bf is not null and latest_bf < baseline_bf)
            or (latest_smm is not null and baseline_smm is not null and latest_smm > baseline_smm)
          )
      )::int as improved_clients
    from roster r
    group by r.coach_id
  )
  select p.id, p.full_name, p.avatar_media_id, a.improved_clients, a.tracked_clients
  from agg a
  join public.profiles p on p.id = a.coach_id
  where a.tracked_clients >= 3
  order by a.improved_clients desc, a.tracked_clients desc, p.full_name asc
  limit greatest(0, least(coalesce(p_limit, 100), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.public_coach_leaderboard(text, integer, integer) from public, anon;
grant execute on function public.public_coach_leaderboard(text, integer, integer) to authenticated, service_role;

-- ── 3. The viewer's OWN rank on the athlete board ────────────────────────────
-- Returns ONE row only when the caller has a qualifying verified reading for the given
-- sex + window: their rank (1 + #opted-in-public athletes ranked strictly above them),
-- the board size, and their own FFMI. Zero rows ⇒ the caller has no standing (the app
-- shows a "log a verified reading / opt in" nudge instead). Returns only the caller's own
-- data; no other athlete's row is exposed.
create or replace function public.public_athlete_my_rank(
  p_sex    text default 'male',
  p_period text default 'all'
)
returns table (
  rank  integer,
  total integer,
  ffmi  numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select
      round(
        ((l.weight_grams / 1000.0) * (1 - l.body_fat_bp / 10000.0))
          / power(ap.height_cm / 100.0, 2),
        1
      ) as ffmi
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
    where p.id = auth.uid()
      and ap.height_cm is not null
      and ap.sex is not null
      and ap.sex::text = p_sex
  ),
  board as (
    select
      round(
        ((l.weight_grams / 1000.0) * (1 - l.body_fat_bp / 10000.0))
          / power(ap.height_cm / 100.0, 2),
        1
      ) as ffmi
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
  )
  select
    (select count(*)::int from board b where b.ffmi > m.ffmi) + 1 as rank,
    (select count(*)::int from board)                            as total,
    m.ffmi
  from me m;
$$;

revoke all on function public.public_athlete_my_rank(text, text) from public, anon;
grant execute on function public.public_athlete_my_rank(text, text) to authenticated, service_role;
