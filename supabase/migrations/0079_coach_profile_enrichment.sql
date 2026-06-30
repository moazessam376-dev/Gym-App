-- 0079_coach_profile_enrichment.sql
--
-- Engagement E3 — make the coach profile a credibility surface. Adds:
--   * coaching_philosophy (longer-form approach, ≤1000 chars), featured_template_id (a sample
--     plan to showcase), accepting_clients (availability badge).
--   * get_public_coach_profile (carry @handle from 0070) + the new fields + an OUTCOME headline:
--     active_roster_count and median_goal_progress (median client_goal_progress across the
--     roster) — real numbers, not the vanity "% improved".
--   * coach_public_highlights (base = 0044, NOT 0070 — 0070 never touched it) + per-goal
--     median_progress.
-- client_goal_progress (0072) is service_role-only but these DEFINER fns are owned by the same
-- role, so they may call it. list_public_coaches (0070) is intentionally LEFT ALONE (it already
-- shows tracked/improved counts on Discover; touching it = the repo's highest-collision RPC).
-- Idempotent: drop the changed-shape fns then recreate, re-applying the 0044/0070 grants.

alter table public.coach_profile
  add column if not exists coaching_philosophy  text,
  add column if not exists featured_template_id uuid references public.plans (id) on delete set null,
  add column if not exists accepting_clients    boolean not null default true;

alter table public.coach_profile drop constraint if exists coach_profile_philosophy_len;
alter table public.coach_profile add constraint coach_profile_philosophy_len
  check (coaching_philosophy is null or char_length(coaching_philosophy) <= 1000);

-- ── get_public_coach_profile (+ handle + new fields + outcome headline) ──────
drop function if exists public.get_public_coach_profile(uuid);
create function public.get_public_coach_profile(p_coach_id uuid)
returns table (
  coach_id             uuid,
  full_name            text,
  handle               text,
  avatar_media_id      uuid,
  bio                  text,
  specialties          text[],
  years_experience     integer,
  certifications       text,
  achievements         text[],
  coaching_philosophy  text,
  accepting_clients    boolean,
  featured_template_id uuid,
  active_roster_count  integer,
  median_goal_progress numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.full_name, p.handle, p.avatar_media_id,
    c.bio, c.specialties, c.years_experience, c.certifications, c.achievements,
    c.coaching_philosophy, c.accepting_clients, c.featured_template_id,
    (select count(*)::int from public.profiles cl where cl.coach_id = p.id) as active_roster_count,
    (
      select round(percentile_cont(0.5) within group (order by gp.gp)::numeric, 1)
      from public.profiles cl
      join lateral (select public.client_goal_progress(cl.id) as gp) gp on true
      where cl.coach_id = p.id and gp.gp is not null
    ) as median_goal_progress
  from public.coach_profile c
  join public.profiles p on p.id = c.user_id
  where c.user_id = p_coach_id
    and (c.is_public or c.user_id = auth.uid());
$$;
revoke all on function public.get_public_coach_profile(uuid) from public, anon;
grant execute on function public.get_public_coach_profile(uuid) to authenticated, service_role;

-- ── coach_public_highlights (base 0044) + per-goal median ────────────────────
drop function if exists public.coach_public_highlights(uuid);
create function public.coach_public_highlights(p_coach_id uuid)
returns table (
  primary_goal    text,
  client_count    integer,
  with_progress   integer,
  improved        integer,
  median_progress numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with roster as (
    select
      p.id as client_id,
      ap.primary_goal::text as primary_goal,
      b.body_fat_bp as baseline_bf, b.smm_grams as baseline_smm,
      l.body_fat_bp as latest_bf,   l.smm_grams as latest_smm,
      cnt.n as verified_n,
      public.client_goal_progress(p.id) as gp
    from public.profiles p
    left join public.athlete_profile ap on ap.user_id = p.id
    join lateral (select count(*)::int as n from public.body_metrics m where m.user_id = p.id and m.verified_at is not null) cnt on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm_grams from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null order by m.measured_at asc, m.created_at asc limit 1
    ) b on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm_grams from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null order by m.measured_at desc, m.created_at desc limit 1
    ) l on true
    where p.coach_id = p_coach_id
      and exists (select 1 from public.coach_profile c where c.user_id = p_coach_id and (c.is_public or c.user_id = auth.uid()))
  )
  select
    coalesce(primary_goal, 'unspecified') as primary_goal,
    count(*)::int as client_count,
    count(*) filter (where verified_n >= 2)::int as with_progress,
    count(*) filter (
      where verified_n >= 2 and (
        (latest_bf is not null and baseline_bf is not null and latest_bf < baseline_bf)
        or (latest_smm is not null and baseline_smm is not null and latest_smm > baseline_smm)
      )
    )::int as improved,
    round(percentile_cont(0.5) within group (order by gp)::numeric, 1) as median_progress
  from roster
  group by 1
  order by client_count desc;
$$;
revoke all on function public.coach_public_highlights(uuid) from public, anon;
grant execute on function public.coach_public_highlights(uuid) to authenticated, service_role;
