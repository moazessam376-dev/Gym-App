-- 0070_public_read_handle_and_outcomes.sql
--
-- Enrich the public-read allowlist RPCs (0044) — they're DROP+CREATEd (not replaced)
-- because the return TABLE shape changes; each re-applies the EXACT 0044 grants
-- (`revoke all … from public, anon` removes the anon-by-name grant → advisor 0028 clean):
--
--   * U-6 surface: add @handle to get_public_coach_profile / get_public_athlete_profile /
--     list_public_coaches so the identity anchor shows on public profiles + discover.
--   * U-4: add tracked_clients + improved_clients to list_public_coaches (the same
--     verified-readings outcome proof public_coach_leaderboard computes, 0045) so the
--     "specialist list" shows results, not just a directory. NO ≥3 floor here (show what a
--     coach has). Keeps the L-9 length cap on p_specialty.
-- The column list stays the allowlist (still no birth_date/sex/height/injuries). Idempotent.

-- ── Coach public portfolio + @handle ─────────────────────────────────────────
drop function if exists public.get_public_coach_profile(uuid);
create function public.get_public_coach_profile(p_coach_id uuid)
returns table (
  coach_id         uuid,
  full_name        text,
  handle           text,
  avatar_media_id  uuid,
  bio              text,
  specialties      text[],
  years_experience integer,
  certifications   text,
  achievements     text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.handle, p.avatar_media_id,
         c.bio, c.specialties, c.years_experience, c.certifications, c.achievements
  from public.coach_profile c
  join public.profiles p on p.id = c.user_id
  where c.user_id = p_coach_id
    and (c.is_public or c.user_id = auth.uid());
$$;
revoke all on function public.get_public_coach_profile(uuid) from public, anon;
grant execute on function public.get_public_coach_profile(uuid) to authenticated, service_role;

-- ── Athlete public profile (minimal allowlist) + @handle ─────────────────────
drop function if exists public.get_public_athlete_profile(uuid);
create function public.get_public_athlete_profile(p_athlete_id uuid)
returns table (
  athlete_id          uuid,
  full_name           text,
  handle              text,
  avatar_media_id     uuid,
  primary_goal        text,
  public_achievements text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.handle, p.avatar_media_id,
         a.primary_goal::text, a.public_achievements
  from public.athlete_profile a
  join public.profiles p on p.id = a.user_id
  where a.user_id = p_athlete_id
    and (a.is_public or a.user_id = auth.uid());
$$;
revoke all on function public.get_public_athlete_profile(uuid) from public, anon;
grant execute on function public.get_public_athlete_profile(uuid) to authenticated, service_role;

-- ── Discover coaches: @handle + outcome counts + length cap ──────────────────
drop function if exists public.list_public_coaches(text, integer, integer);
create function public.list_public_coaches(
  p_specialty text default null,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (
  coach_id         uuid,
  full_name        text,
  handle           text,
  avatar_media_id  uuid,
  specialties      text[],
  years_experience integer,
  bio              text,
  tracked_clients  integer,
  improved_clients integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.full_name, p.handle, p.avatar_media_id,
    c.specialties, c.years_experience, c.bio,
    coalesce(o.tracked_clients, 0),
    coalesce(o.improved_clients, 0)
  from public.coach_profile c
  join public.profiles p on p.id = c.user_id
  left join lateral (
    -- Per-client verified-reading trend for this coach (mirrors public_coach_leaderboard).
    select
      count(*) filter (where verified_n >= 2)::int as tracked_clients,
      count(*) filter (
        where verified_n >= 2
          and (
            (latest_bf is not null and baseline_bf is not null and latest_bf < baseline_bf)
            or (latest_smm is not null and baseline_smm is not null and latest_smm > baseline_smm)
          )
      )::int as improved_clients
    from (
      select
        (select count(*) from public.body_metrics m where m.user_id = cl.id and m.verified_at is not null) as verified_n,
        (select m.body_fat_bp from public.body_metrics m where m.user_id = cl.id and m.verified_at is not null order by m.measured_at asc, m.created_at asc limit 1) as baseline_bf,
        (select m.skeletal_muscle_mass_grams from public.body_metrics m where m.user_id = cl.id and m.verified_at is not null order by m.measured_at asc, m.created_at asc limit 1) as baseline_smm,
        (select m.body_fat_bp from public.body_metrics m where m.user_id = cl.id and m.verified_at is not null order by m.measured_at desc, m.created_at desc limit 1) as latest_bf,
        (select m.skeletal_muscle_mass_grams from public.body_metrics m where m.user_id = cl.id and m.verified_at is not null order by m.measured_at desc, m.created_at desc limit 1) as latest_smm
      from public.profiles cl
      where cl.coach_id = p.id
    ) roster
  ) o on true
  where c.is_public
    and (
      p_specialty is null
      or exists (
        select 1 from unnest(c.specialties) s
        where s ilike '%' || left(p_specialty, 100) || '%'
      )
    )
  order by c.years_experience desc nulls last, p.full_name asc
  limit greatest(0, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.list_public_coaches(text, integer, integer) from public, anon;
grant execute on function public.list_public_coaches(text, integer, integer) to authenticated, service_role;
