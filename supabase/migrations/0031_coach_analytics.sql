-- 0031_coach_analytics.sql
--
-- Phase 15 — Coach KPI Analytics (the anchor). A code-driven insights engine that
-- tells a coach which athletes are winning, which plans deliver, and how their roster
-- is adhering. The numbers are DETERMINISTIC SQL; AI only narrates them (a separate
-- Edge Function). Three additive changes, all reusing the established cross-tenant
-- pattern (coach_body_metrics_board / coach_leaderboard):
--   1. New ai_usage_kind value 'coach_analytics' — the per-feature rate-limit key (§9)
--      for the narration function. ADD VALUE IF NOT EXISTS is transaction-safe (the
--      value is only USED at runtime by the Edge Function, never in this migration).
--   2. coach_analytics_insights — the coach-only AI summary text (one current row per
--      coach; re-running replaces it). Unlike plan_insights (whose owner is the athlete,
--      so its RLS omits an owner branch), HERE the owner is the COACH — so the read
--      policy keeps a coach-owner branch. Service-role write only.
--   3. Two SECURITY DEFINER RPCs — coach_adherence_overview + coach_plan_effectiveness —
--      each HARD-fenced to coach_id = auth.uid() and rejecting a non-coach caller, so a
--      coach can never read another coach's roster. They return RAW integer fields; the
--      app computes the adherence % / goal-progress score (a product choice, kept out of
--      the trusted SQL — same split coach_body_metrics_board uses).
-- Integer units throughout (grams/bp/kcal). Idempotent so it can be re-pasted.

-- ── 1. New per-feature rate-limit key on the 0027 ledger enum ────────────────
alter type public.ai_usage_kind add value if not exists 'coach_analytics';

-- ── 2. coach_analytics_insights — COACH-ONLY AI summary for the coach's roster ──
create table if not exists public.coach_analytics_insights (
  coach_id   uuid primary key references public.profiles (id) on delete cascade,
  analysis   text not null,
  provider   text,           -- which AI provider produced it (audit)
  model      text,
  created_at timestamptz not null default now(),   -- UTC (§11)
  updated_at timestamptz not null default now()
);

alter table public.coach_analytics_insights enable row level security;

drop trigger if exists coach_analytics_insights_set_updated_at on public.coach_analytics_insights;
create trigger coach_analytics_insights_set_updated_at
  before update on public.coach_analytics_insights
  for each row execute function public.set_updated_at();

-- Read: the owning COACH (it's their own roster summary) or an admin. Writes are
-- service-role only (the coach-analytics-summary Edge Function) — no client write path.
drop policy if exists coach_analytics_insights_select on public.coach_analytics_insights;
create policy coach_analytics_insights_select on public.coach_analytics_insights
  for select to authenticated
  using (
    coach_id = auth.uid()
    or public.current_app_role() = 'admin'
  );

grant select on public.coach_analytics_insights to anon, authenticated;  -- anon: RLS -> 0 rows
-- No insert/update/delete grant — the trusted server path (service role) owns writes.

-- ── 3a. coach_adherence_overview: per-client roster adherence, coach-fenced ──────
-- SECURITY DEFINER so it can aggregate across the coach's clients' sessions/food logs
-- in one pass, but it NEVER returns a row whose coach_id <> auth.uid() — the WHERE
-- clause is the leak-proof tenancy fence. A non-coach caller is rejected; anon can't
-- execute it (no grant). Returns raw counts; the app computes adherence % against the
-- athlete's own training_days target (a product choice, not a security boundary).
create or replace function public.coach_adherence_overview(p_since date)
returns table (
  client_id            uuid,
  full_name            text,
  primary_goal         text,
  training_days_target integer,
  sessions_completed   integer,
  nutrition_days       integer,
  last_session_date    date
)
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
      ap.primary_goal::text,
      ap.training_days,
      coalesce(ws.n, 0),
      coalesce(fn.n, 0),
      la.last_date
    from public.profiles p
    left join public.athlete_profile ap on ap.user_id = p.id
    -- Completed training sessions inside the window.
    left join lateral (
      select count(*)::int as n
      from public.workout_sessions s
      where s.user_id = p.id
        and s.status = 'completed'
        and s.session_date >= p_since
    ) ws on true
    -- Distinct days the athlete logged any food inside the window.
    left join lateral (
      select count(distinct e.log_date)::int as n
      from public.food_log_entries e
      where e.user_id = p.id
        and e.log_date >= p_since
    ) fn on true
    -- Overall last-active (last completed session, any date) — "last seen training".
    left join lateral (
      select max(s.session_date) as last_date
      from public.workout_sessions s
      where s.user_id = p.id and s.status = 'completed'
    ) la on true
    where p.coach_id = auth.uid();        -- HARD tenancy fence
end;
$$;

revoke all on function public.coach_adherence_overview(date) from public, anon;
grant execute on function public.coach_adherence_overview(date) to authenticated, service_role;

-- ── 3b. coach_plan_effectiveness: published plans + the client's verified trend ──
-- SECURITY DEFINER, fenced to coach_id = auth.uid(). For each PUBLISHED, client-assigned
-- plan it returns the plan provenance (source_plan_id template lineage + ai_generated)
-- and the client's earliest + latest VERIFIED body-composition reading (same verified-only
-- lateral joins as coach_body_metrics_board). The returned row is shape-compatible with
-- BoardRow so the app scores it with the existing goalProgress() — "top performing plans"
-- and the AI-vs-hand-built split are computed app-side from the caller's own roster only.
create or replace function public.coach_plan_effectiveness()
returns table (
  plan_id               uuid,
  source_plan_id        uuid,
  title                 text,
  plan_type             text,   -- 'training' | 'nutrition' (avoids the keyword `type` as an OUT name)
  ai_generated          boolean,
  plan_created_at       timestamptz,
  client_id             uuid,
  full_name             text,
  primary_goal          text,
  target_weight_grams   integer,
  entries               integer,
  baseline_at           timestamptz,
  baseline_weight_grams integer,
  baseline_body_fat_bp  integer,
  baseline_smm_grams    integer,
  latest_at             timestamptz,
  latest_weight_grams   integer,
  latest_body_fat_bp    integer,
  latest_smm_grams      integer
)
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
      pl.id,
      pl.source_plan_id,
      pl.title,
      pl.type::text,
      pl.ai_generated,
      pl.created_at,
      p.id,
      p.full_name,
      ap.primary_goal::text,
      ap.target_weight_grams,
      cnt.n,
      b.measured_at, b.weight_grams, b.body_fat_bp, b.skeletal_muscle_mass_grams,
      l.measured_at, l.weight_grams, l.body_fat_bp, l.skeletal_muscle_mass_grams
    from public.plans pl
    join public.profiles p on p.id = pl.client_id
    left join public.athlete_profile ap on ap.user_id = p.id
    join lateral (
      select count(*)::int as n
      from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null
    ) cnt on true
    left join lateral (
      select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams
      from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null
      order by m.measured_at asc, m.created_at asc
      limit 1
    ) b on true
    left join lateral (
      select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams
      from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null
      order by m.measured_at desc, m.created_at desc
      limit 1
    ) l on true
    where pl.coach_id = auth.uid()        -- HARD tenancy fence
      and pl.client_id is not null
      and pl.status = 'published';
end;
$$;

revoke all on function public.coach_plan_effectiveness() from public, anon;
grant execute on function public.coach_plan_effectiveness() to authenticated, service_role;
