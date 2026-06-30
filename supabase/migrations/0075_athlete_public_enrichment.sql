-- 0075_athlete_public_enrichment.sql
--
-- Engagement E2 — turn the 6-field athlete public profile into a data-driven story, all from
-- data the user already logs. Recreates get_public_athlete_profile (latest was 0070) with:
--   * Activity (gated on is_public — lower sensitivity): current streak, workouts in the last
--     30 days, training days/week, a top-5 PR gallery, and a "training with <coach>" chip
--     (only when the coach is also public — mutual consent).
--   * Body transformation (gated on share_body_metrics_publicly — a SEPARATE opt-in, added in
--     0073): baseline/latest dates, body-fat + lean-mass deltas, latest FFMI + tier, target vs
--     latest weight (the goal-progress bar), and a verified weight/body-fat series for the chart.
--
-- The column list IS the allowlist (RLS is row-level): raw weight/height/sex are never returned
-- except where the athlete explicitly opted in to sharing body metrics. The owner always sees
-- their own full profile (preview). Param/return names kept as p_athlete_id / athlete_id so
-- existing callers (src/lib/public-profiles.ts) keep working. compute_ffmi/ffmi_tier from 0072.
-- Idempotent (drop+create because the return shape changes; ACL re-granted).

drop function if exists public.get_public_athlete_profile(uuid);
create function public.get_public_athlete_profile(p_athlete_id uuid)
returns table (
  athlete_id            uuid,
  full_name             text,
  handle                text,
  avatar_media_id       uuid,
  primary_goal          text,
  public_achievements   text[],
  -- activity (is_public)
  current_streak        integer,
  workouts_last_30d     integer,
  training_days         integer,
  top_prs               jsonb,   -- [{exercise_name, best_load_grams, best_e1rm_grams, best_reps}]
  coach_id              uuid,
  coach_name            text,
  coach_avatar_media_id uuid,
  -- body transformation (share_body_metrics_publicly) — null when not shared
  share_body_metrics    boolean,
  has_transformation    boolean,
  baseline_at           timestamptz,
  latest_at             timestamptz,
  body_fat_delta_bp     integer, -- + = lost
  lean_mass_delta_grams integer, -- + = gained
  ffmi_latest           numeric,
  ffmi_tier             text,
  target_weight_grams   integer,
  latest_weight_grams   integer,
  body_metrics_series   jsonb    -- [{measured_at, weight_grams, body_fat_bp}] verified, asc
)
language sql
stable
security definer
set search_path = ''
as $$
  with base as (
    select p.id, p.full_name, p.handle, p.avatar_media_id, p.coach_id,
           a.primary_goal::text as primary_goal, a.public_achievements,
           a.training_days, a.target_weight_grams, a.height_cm, a.sex::text as sex,
           (a.share_body_metrics_publicly or a.user_id = auth.uid()) as show_body
    from public.athlete_profile a
    join public.profiles p on p.id = a.user_id
    where a.user_id = p_athlete_id
      and (a.is_public or a.user_id = auth.uid())
  ),
  v as (
    select measured_at, weight_grams, body_fat_bp, skeletal_muscle_mass_grams
    from public.body_metrics
    where user_id = p_athlete_id and verified_at is not null
    order by measured_at asc, created_at asc
  ),
  agg as (
    select
      count(*) as n,
      (array_agg(measured_at order by measured_at asc))[1]                as baseline_at,
      (array_agg(measured_at order by measured_at desc))[1]               as latest_at,
      (array_agg(body_fat_bp order by measured_at asc))[1]               as base_bf,
      (array_agg(body_fat_bp order by measured_at desc))[1]              as latest_bf,
      (array_agg(skeletal_muscle_mass_grams order by measured_at asc))[1]  as base_smm,
      (array_agg(skeletal_muscle_mass_grams order by measured_at desc))[1] as latest_smm,
      (array_agg(weight_grams order by measured_at desc))[1]             as latest_weight
    from v
  )
  select
    b.id, b.full_name, b.handle, b.avatar_media_id,
    b.primary_goal, b.public_achievements,
    public.current_streak(p_athlete_id),
    (select count(*)::int from public.workout_sessions
       where user_id = p_athlete_id and status = 'completed'
         and session_date >= (now() at time zone 'utc')::date - 30),
    b.training_days,
    coalesce((select jsonb_agg(x) from (
      select exercise_name, best_load_grams, best_e1rm_grams, best_reps
      from public.v_exercise_prs
      where user_id = p_athlete_id
      order by best_e1rm_grams desc nulls last
      limit 5
    ) x), '[]'::jsonb),
    cc.coach_id, cc.coach_name, cc.coach_avatar,
    b.show_body,
    case when b.show_body then (ag.n >= 2) else null end,
    case when b.show_body then ag.baseline_at else null end,
    case when b.show_body then ag.latest_at else null end,
    case when b.show_body and ag.base_bf is not null and ag.latest_bf is not null
         then ag.base_bf - ag.latest_bf else null end,
    case when b.show_body and ag.base_smm is not null and ag.latest_smm is not null
         then ag.latest_smm - ag.base_smm else null end,
    case when b.show_body then public.compute_ffmi(ag.latest_weight, ag.latest_bf, b.height_cm) else null end,
    case when b.show_body then public.ffmi_tier(public.compute_ffmi(ag.latest_weight, ag.latest_bf, b.height_cm), b.sex) else null end,
    case when b.show_body then b.target_weight_grams else null end,
    case when b.show_body then ag.latest_weight else null end,
    case when b.show_body then coalesce((
      select jsonb_agg(jsonb_build_object('measured_at', measured_at, 'weight_grams', weight_grams, 'body_fat_bp', body_fat_bp) order by measured_at asc)
      from v
    ), '[]'::jsonb) else null end
  from base b
  cross join agg ag
  left join lateral (
    select cp.id as coach_id, cp.full_name as coach_name, cp.avatar_media_id as coach_avatar
    from public.profiles cp
    where cp.id = b.coach_id and public.is_public_profile(cp.id)
  ) cc on true;
$$;
revoke all on function public.get_public_athlete_profile(uuid) from public, anon;
grant execute on function public.get_public_athlete_profile(uuid) to authenticated, service_role;
