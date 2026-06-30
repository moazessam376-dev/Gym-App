-- 0074_self_achievement_caps.sql
--
-- Engagement E1 — cap the SELF-ASSIGNED achievements at 3 (founder decision). These are
-- the user-typed text[] (athlete_profile.public_achievements / coach_profile.achievements),
-- distinct from the system-minted trophies in 0073. The editor previously allowed up to 20.
--
-- Existing arrays longer than 3 are trimmed to the first 3 FIRST, so the CHECK can be added
-- as VALID (a NOT-VALID constraint would still reject the next edit of an over-cap row).
-- array_length over an empty/NULL array is NULL → the check passes (no entries). Idempotent.

update public.athlete_profile
  set public_achievements = public_achievements[1:3]
  where array_length(public_achievements, 1) > 3;

update public.coach_profile
  set achievements = achievements[1:3]
  where array_length(achievements, 1) > 3;

alter table public.athlete_profile drop constraint if exists athlete_profile_self_achievements_cap;
alter table public.athlete_profile add constraint athlete_profile_self_achievements_cap
  check (public_achievements is null or array_length(public_achievements, 1) is null or array_length(public_achievements, 1) <= 3);

alter table public.coach_profile drop constraint if exists coach_profile_self_achievements_cap;
alter table public.coach_profile add constraint coach_profile_self_achievements_cap
  check (achievements is null or array_length(achievements, 1) is null or array_length(achievements, 1) <= 3);
