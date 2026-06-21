-- 0018_sex_male_female.sql
--
-- Narrow the `sex` enum to male/female only. The app tracks biological sex for
-- accurate calorie/TDEE estimates (Phase 10), so 'other'/'prefer_not_to_say' are
-- removed. Postgres can't drop enum values in place, so we recreate the type.
-- Any pre-existing other/prefer_not_to_say values map to NULL. Guarded so it's
-- idempotent (only recreates while the old labels still exist).
do $$
begin
  if exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'sex' and e.enumlabel in ('other', 'prefer_not_to_say')
  ) then
    alter type public.sex rename to sex__old;
    create type public.sex as enum ('male', 'female');
    alter table public.athlete_profile
      alter column sex type public.sex
      using (case when sex::text in ('male', 'female') then sex::text::public.sex else null end);
    drop type public.sex__old;
  end if;
end
$$;
