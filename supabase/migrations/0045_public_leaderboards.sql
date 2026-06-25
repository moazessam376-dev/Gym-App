-- 0045_public_leaderboards.sql
--
-- Phase 20 — Public leaderboards + tiered leagues.
--
-- Two PUBLIC, ranked boards browsable by any authenticated user:
--   * Top Athletes — a tiered physique league (Bronze→Apex) ranked by FFMI
--     (height-normalized lean mass) from each athlete's LATEST COACH-VERIFIED InBody.
--     Separate men's / women's boards (sex-appropriate norms); the board segment is a
--     query parameter and sex is NEVER returned per-row.
--   * Top Coaches — ranked by VERIFIED client outcomes (aggregate counts only, no client
--     ids), since coaches have no body-metrics of their own.
--
-- This is the app's newest privacy frontier, so it follows the Phase 19 (0044) discipline
-- exactly:
--   * Audience is AUTHENTICATED users only (no `to anon` path).
--   * RLS is row-level, NOT column-level — a raw public read policy would leak EVERY column
--     of a row (an athlete's weight / body-fat / height / sex). So the public surface is a
--     pair of SECURITY DEFINER, field-allowlist RPCs; the raw tables get NO new read path.
--     The athlete RPC returns only the DERIVED FFMI index (never its weight/body-fat/height
--     inputs, never sex); the coach RPC returns COUNTS only (mirrors coach_public_highlights).
--   * Appearing on a ranked physique/outcomes board is a bigger disclosure than a profile
--     page, so it takes its OWN explicit opt-in (`leaderboard_opt_in`), on top of having a
--     public profile (`is_public`).
--
-- Anti-cheat by construction: only `verified_at is not null` body_metrics feed the ranks,
-- and the 0026 trigger guarantees athletes can't self-verify. Banned users (profiles.banned_at)
-- are excluded from both boards.
--
-- The tier-band thresholds (FFMI → Bronze…Apex) live in the APP (src/lib/leagues.ts), not
-- here: the RPC returns the FFMI number and the client maps it to a tier, so the bands stay
-- tunable without a migration. Idempotent so it can be re-pasted.

-- ── 1. Opt-in columns (owner-controlled, default OFF) ────────────────────────
-- `leaderboard_opt_in` is the user's OWN toggle, governed by the existing owner-only UPDATE
-- policies (exactly like 0044's `is_public`) — no new policy / immutability needed.
alter table public.athlete_profile
  add column if not exists leaderboard_opt_in boolean not null default false;

alter table public.coach_profile
  add column if not exists leaderboard_opt_in boolean not null default false;

-- ── 2. Top Athletes board (per-sex, FFMI-ranked) ─────────────────────────────
-- SECURITY DEFINER + search_path='' so it can read across many athletes' verified metrics in
-- one pass without re-entering their RLS. Granted to authenticated only (never anon). The
-- SELECT column list IS the allowlist: name / avatar / goal / derived FFMI — never the raw
-- weight/body-fat/height inputs, never sex (sex is only the WHERE filter).
create or replace function public.public_athlete_leaderboard(
  p_sex   text,
  p_limit integer default 100,
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
    -- FFMI = lean mass (kg) / height (m)^2, lean = weight * (1 − body-fat fraction).
    -- weight_grams/1000 = kg; body_fat_bp/10000 = fraction (1850bp → 0.185); height_cm/100 = m.
    round(
      ((l.weight_grams / 1000.0) * (1 - l.body_fat_bp / 10000.0))
        / power(ap.height_cm / 100.0, 2),
      1
    ) as ffmi
  from public.profiles p
  join public.athlete_profile ap on ap.user_id = p.id
  -- Latest COACH-VERIFIED reading that has a body-fat number (FFMI needs both weight + BF).
  join lateral (
    select m.weight_grams, m.body_fat_bp
    from public.body_metrics m
    where m.user_id = p.id
      and m.verified_at is not null
      and m.body_fat_bp is not null
    order by m.measured_at desc, m.created_at desc
    limit 1
  ) l on true
  where ap.leaderboard_opt_in            -- explicit opt-in to the board
    and ap.is_public                     -- AND a public profile to link the row to
    and p.banned_at is null              -- banned users never appear
    and ap.height_cm is not null         -- FFMI needs height
    and ap.sex is not null
    and ap.sex::text = p_sex             -- the men's / women's segment
  order by ffmi desc nulls last, p.full_name asc
  limit greatest(0, least(coalesce(p_limit, 100), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.public_athlete_leaderboard(text, integer, integer) from public, anon;
grant execute on function public.public_athlete_leaderboard(text, integer, integer) to authenticated, service_role;

-- ── 3. Top Coaches board (verified client outcomes — counts only) ────────────
-- Same security shape. Returns AGGREGATE counts per opted-in public coach — never a client
-- id/name (same rule as 0044's coach_public_highlights). A coach's standing is how many of
-- their tracked clients (>=2 coach-verified readings) trended in a healthy direction (body
-- fat down OR skeletal muscle up) vs baseline. A floor of >=3 tracked clients keeps a single
-- "1/1 improved" client from reading as a top coach.
create or replace function public.public_coach_leaderboard(
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
    join lateral (
      select count(*)::int as n
      from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
    ) cnt on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
      from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
      order by m.measured_at asc, m.created_at asc
      limit 1
    ) b on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
      from public.body_metrics m
      where m.user_id = cl.id and m.verified_at is not null
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
  where a.tracked_clients >= 3          -- credibility floor
  order by a.improved_clients desc, a.tracked_clients desc, p.full_name asc
  limit greatest(0, least(coalesce(p_limit, 100), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.public_coach_leaderboard(integer, integer) from public, anon;
grant execute on function public.public_coach_leaderboard(integer, integer) to authenticated, service_role;
