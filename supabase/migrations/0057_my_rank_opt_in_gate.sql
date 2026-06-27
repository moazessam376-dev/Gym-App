-- 0057_my_rank_opt_in_gate.sql
--
-- Bug fix (Slice G1 leaderboard): an athlete who is NOT opted in (leaderboard_opt_in
-- = false / is_public = false) but has a verified InBody reading still saw a pinned
-- "You · #rank" card, while coaches (and everyone else) correctly did NOT see them on
-- the board — because public_athlete_leaderboard gates on `leaderboard_opt_in AND
-- is_public` but public_athlete_my_rank's `me` CTE only required `auth.uid()` + a
-- reading. That asymmetry handed non-opted athletes a rank they hadn't opted into.
--
-- Fix: gate `me` the same way as the board. A non-opted athlete now gets `me` empty →
-- rank NULL → the UI (MyStandingCard) shows the "opt in to compete" nudge instead of a
-- bogus rank. The `board` CTE is unchanged (it was already correctly gated).

create or replace function public.public_athlete_my_rank(
  p_sex text default 'male',
  p_period text default 'all'
)
returns table(rank integer, total integer, ffmi numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select round(((l.weight_grams / 1000.0) * (1 - l.body_fat_bp / 10000.0)) / power(ap.height_cm / 100.0, 2), 1) as ffmi
    from public.profiles p
    join public.athlete_profile ap on ap.user_id = p.id
    join lateral (
      select m.weight_grams, m.body_fat_bp from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null and m.body_fat_bp is not null
        and (p_period not in ('month','quarter') or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end))
      order by m.measured_at desc, m.created_at desc limit 1
    ) l on true
    where p.id = auth.uid()
      and ap.leaderboard_opt_in and ap.is_public and p.banned_at is null
      and ap.height_cm is not null and ap.sex is not null and ap.sex::text = p_sex
  ),
  board as (
    select round(((l.weight_grams / 1000.0) * (1 - l.body_fat_bp / 10000.0)) / power(ap.height_cm / 100.0, 2), 1) as ffmi
    from public.profiles p
    join public.athlete_profile ap on ap.user_id = p.id
    join lateral (
      select m.weight_grams, m.body_fat_bp from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null and m.body_fat_bp is not null
        and (p_period not in ('month','quarter') or m.measured_at >= now() - (case p_period when 'month' then interval '30 days' else interval '90 days' end))
      order by m.measured_at desc, m.created_at desc limit 1
    ) l on true
    where ap.leaderboard_opt_in and ap.is_public and p.banned_at is null
      and ap.height_cm is not null and ap.sex is not null and ap.sex::text = p_sex
  )
  select
    (select count(*)::int from board b where b.ffmi > m.ffmi) + 1 as rank,
    (select count(*)::int from board) as total,
    m.ffmi
  from me m;
$$;

revoke all on function public.public_athlete_my_rank(text, text) from public;
grant execute on function public.public_athlete_my_rank(text, text) to authenticated, service_role;
