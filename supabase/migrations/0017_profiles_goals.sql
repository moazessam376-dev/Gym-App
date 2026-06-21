-- 0017_profiles_goals.sql
--
-- Phase 9: the personalization FOUNDATION. Two owner-scoped tables capturing an
-- athlete's goals and a coach's profile, read by later pillars (macro targets,
-- progress framing, ranks). Same deny-by-default tenancy as the rest of the app
-- (§2, foundations.md): a client owns their athlete_profile (their coach + admin
-- read it); a coach owns their coach_profile (their clients + admin read it).
-- Integer units only (foundations.md §3). Idempotent so it can be re-pasted.

-- ── Enums ─────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'athlete_goal') then
    create type public.athlete_goal as enum
      ('lose_fat', 'build_muscle', 'maintain', 'gain_strength', 'improve_health', 'sport_performance');
  end if;
  if not exists (select 1 from pg_type where typname = 'experience_level') then
    create type public.experience_level as enum ('beginner', 'intermediate', 'advanced');
  end if;
  if not exists (select 1 from pg_type where typname = 'activity_level') then
    create type public.activity_level as enum ('sedentary', 'light', 'moderate', 'active', 'very_active');
  end if;
  if not exists (select 1 from pg_type where typname = 'sex') then
    create type public.sex as enum ('male', 'female', 'other', 'prefer_not_to_say');
  end if;
end
$$;

-- ── athlete_profile (one per client; client-owned) ────────────────────────────
create table if not exists public.athlete_profile (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  primary_goal        public.athlete_goal,
  experience_level    public.experience_level,
  sex                 public.sex,
  birth_date          date,
  height_cm           integer check (height_cm is null or (height_cm > 0 and height_cm < 300)),
  target_weight_grams integer check (target_weight_grams is null or target_weight_grams > 0),
  activity_level      public.activity_level,
  training_days       integer check (training_days is null or (training_days >= 0 and training_days <= 7)),
  dietary_tags        text[] not null default '{}',
  injuries_notes      text,
  onboarded_at        timestamptz,                          -- set when first completed
  created_at          timestamptz not null default now(),   -- UTC (§11)
  updated_at          timestamptz not null default now()
);

alter table public.athlete_profile enable row level security;

drop trigger if exists athlete_profile_set_updated_at on public.athlete_profile;
create trigger athlete_profile_set_updated_at
  before update on public.athlete_profile
  for each row execute function public.set_updated_at();

-- Read: the owning client, their coach, or an admin (mirrors progress_entries).
drop policy if exists athlete_profile_select on public.athlete_profile;
create policy athlete_profile_select on public.athlete_profile
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_of(user_id)
    or public.current_app_role() = 'admin'
  );

-- Create/Update/Delete: the owner only (the athlete's own self-report).
drop policy if exists athlete_profile_insert on public.athlete_profile;
create policy athlete_profile_insert on public.athlete_profile
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists athlete_profile_update on public.athlete_profile;
create policy athlete_profile_update on public.athlete_profile
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists athlete_profile_delete on public.athlete_profile;
create policy athlete_profile_delete on public.athlete_profile
  for delete to authenticated using (user_id = auth.uid());

grant select on public.athlete_profile to anon, authenticated;   -- anon: RLS -> 0 rows
grant insert, update, delete on public.athlete_profile to authenticated;

-- ── coach_profile (one per coach; coach-owned, readable by their clients) ─────
create table if not exists public.coach_profile (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  bio              text,
  specialties      text[] not null default '{}',
  years_experience integer check (years_experience is null or (years_experience >= 0 and years_experience < 80)),
  certifications   text,
  onboarded_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.coach_profile enable row level security;

drop trigger if exists coach_profile_set_updated_at on public.coach_profile;
create trigger coach_profile_set_updated_at
  before update on public.coach_profile
  for each row execute function public.set_updated_at();

-- Read: the owning coach, the coach's own clients (via my_coach_id), or an admin.
drop policy if exists coach_profile_select on public.coach_profile;
create policy coach_profile_select on public.coach_profile
  for select to authenticated
  using (
    user_id = auth.uid()
    or user_id = public.my_coach_id()
    or public.current_app_role() = 'admin'
  );

drop policy if exists coach_profile_insert on public.coach_profile;
create policy coach_profile_insert on public.coach_profile
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists coach_profile_update on public.coach_profile;
create policy coach_profile_update on public.coach_profile
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists coach_profile_delete on public.coach_profile;
create policy coach_profile_delete on public.coach_profile
  for delete to authenticated using (user_id = auth.uid());

grant select on public.coach_profile to anon, authenticated;   -- anon: RLS -> 0 rows
grant insert, update, delete on public.coach_profile to authenticated;
