-- 0072_progress_helpers.sql
--
-- Shared progress math, designed ONCE and reused by the achievements triggers (0073),
-- the enriched public profiles (0075/0078), and the leaderboard reframe (0079). Three
-- helpers:
--
--   * compute_ffmi(weight_grams, body_fat_bp, height_cm) — pure math, IMMUTABLE. Mirrors
--     the inline formula in 0045 and src/lib/leagues.ts:computeFfmi EXACTLY (kg / m²,
--     lean = weight × (1 − bodyfat fraction), rounded to 1 dp). No data access → safe to
--     expose to authenticated.
--   * ffmi_tier(ffmi, sex) — maps an FFMI to a league tier (Bronze…Apex), IMMUTABLE.
--     Replicates src/lib/leagues.ts:FFMI_BANDS. NOTE: the TS bands remain the DISPLAY
--     source of truth (tunable without a migration); this SQL copy exists so the trophy
--     triggers + leaderboard can tier server-side. Keep the two in sync if bands change.
--   * client_goal_progress(p_client) — goal-relative progress score, replicating
--     src/lib/body-metrics.ts:goalProgress. Returns NULL when not rankable (one reading,
--     or the goal's metric wasn't measured in both readings). This one reads body_metrics
--     across users, so it is SECURITY DEFINER and INTERNAL-ONLY (service_role) — it is
--     never exposed as a PostgREST RPC; the public RPCs that need it call it internally.
--
-- Idempotent (create or replace). compute_ffmi/ffmi_tier are fresh public functions, so
-- they get the Supabase anon-by-name EXECUTE grant on first create → revoked explicitly.

-- ── compute_ffmi ─────────────────────────────────────────────────────────────
create or replace function public.compute_ffmi(
  p_weight_grams integer,
  p_body_fat_bp  integer,
  p_height_cm    numeric
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_weight_grams is null or p_body_fat_bp is null
         or p_height_cm is null or p_height_cm <= 0
      then null
    else round(
      ((p_weight_grams / 1000.0) * (1 - p_body_fat_bp / 10000.0))
        / power(p_height_cm / 100.0, 2),
      1)
  end;
$$;
revoke all on function public.compute_ffmi(integer, integer, numeric) from public, anon;
grant execute on function public.compute_ffmi(integer, integer, numeric) to authenticated, service_role;

-- ── ffmi_tier ────────────────────────────────────────────────────────────────
-- Highest tier whose lower-bound FFMI is met, per sex. Mirrors src/lib/leagues.ts.
create or replace function public.ffmi_tier(p_ffmi numeric, p_sex text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ffmi is null or p_sex is null then null
    when p_sex = 'male' then case
      when p_ffmi >= 25   then 'apex'
      when p_ffmi >= 23.5 then 'grandmaster'
      when p_ffmi >= 22   then 'master'
      when p_ffmi >= 21   then 'diamond'
      when p_ffmi >= 20   then 'platinum'
      when p_ffmi >= 19   then 'gold'
      when p_ffmi >= 18   then 'silver'
      else 'bronze'
    end
    when p_sex = 'female' then case
      when p_ffmi >= 21.5 then 'apex'
      when p_ffmi >= 20   then 'grandmaster'
      when p_ffmi >= 18.5 then 'master'
      when p_ffmi >= 17.5 then 'diamond'
      when p_ffmi >= 16.5 then 'platinum'
      when p_ffmi >= 15.5 then 'gold'
      when p_ffmi >= 14.5 then 'silver'
      else 'bronze'
    end
    else null
  end;
$$;
revoke all on function public.ffmi_tier(numeric, text) from public, anon;
grant execute on function public.ffmi_tier(numeric, text) to authenticated, service_role;

-- ── client_goal_progress (INTERNAL — service_role only) ──────────────────────
-- Replicates src/lib/body-metrics.ts:goalProgress. Score in "points" (≈ 1 body-fat %
-- lost OR 1 kg muscle gained). NULL = not rankable. SECURITY DEFINER so it can read a
-- client's verified body_metrics regardless of the caller, which is exactly why it must
-- NOT be callable directly by authenticated/anon (it takes an arbitrary client id). Only
-- other DEFINER RPCs (the coach leaderboard / profile outcome stats) call it.
create or replace function public.client_goal_progress(p_client uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_goal      text;
  v_n         integer;
  v_base      record;
  v_latest    record;
  v_fat_pct   numeric;
  v_muscle_kg numeric;
begin
  select ap.primary_goal::text into v_goal
  from public.athlete_profile ap where ap.user_id = p_client;

  select count(*) into v_n
  from public.body_metrics m
  where m.user_id = p_client and m.verified_at is not null;
  if v_n < 2 then return null; end if;

  select m.measured_at, m.body_fat_bp, m.skeletal_muscle_mass_grams into v_base
  from public.body_metrics m
  where m.user_id = p_client and m.verified_at is not null
  order by m.measured_at asc, m.created_at asc
  limit 1;

  select m.measured_at, m.body_fat_bp, m.skeletal_muscle_mass_grams into v_latest
  from public.body_metrics m
  where m.user_id = p_client and m.verified_at is not null
  order by m.measured_at desc, m.created_at desc
  limit 1;

  -- Two DISTINCT readings required (a baseline that equals the latest is one reading).
  if v_base.measured_at = v_latest.measured_at then return null; end if;

  if v_base.body_fat_bp is not null and v_latest.body_fat_bp is not null then
    v_fat_pct := round((v_base.body_fat_bp - v_latest.body_fat_bp) / 100.0, 1);  -- + = lost
  end if;
  if v_base.skeletal_muscle_mass_grams is not null
     and v_latest.skeletal_muscle_mass_grams is not null then
    v_muscle_kg := round((v_latest.skeletal_muscle_mass_grams - v_base.skeletal_muscle_mass_grams) / 1000.0, 1); -- + = gained
  end if;

  if v_goal = 'lose_fat' then
    return v_fat_pct;                              -- null if no body-fat reading → not rankable
  elsif v_goal in ('build_muscle', 'gain_strength') then
    return v_muscle_kg;                            -- null if no muscle reading → not rankable
  else
    -- maintain / improve_health / sport_performance / null → recomposition.
    if v_fat_pct is null and v_muscle_kg is null then return null; end if;
    return coalesce(v_fat_pct, 0) + coalesce(v_muscle_kg, 0);
  end if;
end;
$$;
revoke all on function public.client_goal_progress(uuid) from public, anon, authenticated;
grant execute on function public.client_goal_progress(uuid) to service_role;
