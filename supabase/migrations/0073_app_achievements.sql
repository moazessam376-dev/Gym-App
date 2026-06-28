-- 0073_app_achievements.sql
--
-- Engagement E1 — system-minted trophies (the "PlayStation trophy case"). Triggers mint
-- rows as a user progresses; users NEVER insert them. This is what makes a profile feel
-- alive even if the owner never edits it. Self-assigned achievements (the existing
-- athlete_profile.public_achievements / coach_profile.achievements text[]) are separate
-- and capped at 3 in 0074.
--
-- Ships its table WITH deny-by-default RLS (§2). Minting is a SECURITY DEFINER path
-- (no client INSERT policy). The catalog (key → title/icon/tier) lives in the app
-- (src/lib/achievements.ts), not the DB — tunable without a migration; the DB only stores
-- which keys a user earned.
--
-- Depends on 0072 (compute_ffmi / ffmi_tier) for the tier trophies. Idempotent.

-- Consent column used by the public-read RPC below (and enriched further in 0075/E2):
-- body-derived trophies (body-fat / lean-mass / tier / InBody / goal) are only shown to
-- others when the athlete opts in to sharing body metrics. Added here because the public
-- achievements RPC needs it from creation. Default OFF (privacy-first).
alter table public.athlete_profile
  add column if not exists share_body_metrics_publicly boolean not null default false;

-- ── the trophy case ──────────────────────────────────────────────────────────
create table if not exists public.app_achievements (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  achievement_key text not null,                       -- catalog key, e.g. 'workouts_50'
  awarded_at      timestamptz not null default now(),  -- UTC (§11)
  metadata        jsonb not null default '{}'::jsonb,  -- e.g. {"ffmi":21.4} / {"metric_id":…}
  created_at      timestamptz not null default now()
);

-- One trophy per (user, key) — idempotent minting.
create unique index if not exists app_achievements_one_per_key
  on public.app_achievements (user_id, achievement_key);
create index if not exists app_achievements_user_idx
  on public.app_achievements (user_id, awarded_at desc);

alter table public.app_achievements enable row level security;

-- Read: only the owner sees their raw trophy rows (others read via the public RPC below).
drop policy if exists app_achievements_owner_select on public.app_achievements;
create policy app_achievements_owner_select on public.app_achievements
  for select to authenticated
  using (user_id = auth.uid());

-- NO insert/update/delete policy: minting is the SECURITY DEFINER path only.
grant select on public.app_achievements to anon, authenticated;  -- anon: RLS -> 0 rows

-- ── mint_achievement: the single idempotent minting path (service_role only) ──
create or replace function public.mint_achievement(
  p_user_id  uuid,
  p_key      text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_achievements (user_id, achievement_key, metadata)
  values (p_user_id, p_key, coalesce(p_metadata, '{}'::jsonb))
  on conflict (user_id, achievement_key) do nothing;
end;
$$;
revoke all on function public.mint_achievement(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.mint_achievement(uuid, text, jsonb) to service_role;

-- ── workout trophies: volume + streak + PRs (on session completion) ──────────
-- AFTER INSERT OR UPDATE OF status. Fires when a session becomes 'completed'. Reuses the
-- existing current_streak() (0016) and v_exercise_prs (0023) — both filtered to new.user_id.
-- (They are SECURITY INVOKER; called from this DEFINER trigger they run as the function
-- owner and read across the user's own rows via the explicit user_id filter.)
create or replace function public.tg_mint_workout_achievements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total  integer;
  v_streak integer;
  v_prs    integer;
begin
  if new.status <> 'completed' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'completed' then return new; end if;  -- already counted

  select count(*) into v_total
  from public.workout_sessions
  where user_id = new.user_id and status = 'completed';
  if v_total >= 1   then perform public.mint_achievement(new.user_id, 'first_workout'); end if;
  if v_total >= 10  then perform public.mint_achievement(new.user_id, 'workouts_10');  end if;
  if v_total >= 50  then perform public.mint_achievement(new.user_id, 'workouts_50');  end if;
  if v_total >= 100 then perform public.mint_achievement(new.user_id, 'workouts_100'); end if;

  v_streak := public.current_streak(new.user_id);
  if v_streak >= 7   then perform public.mint_achievement(new.user_id, 'streak_7');   end if;
  if v_streak >= 30  then perform public.mint_achievement(new.user_id, 'streak_30');  end if;
  if v_streak >= 100 then perform public.mint_achievement(new.user_id, 'streak_100'); end if;

  select count(*) into v_prs from public.v_exercise_prs where user_id = new.user_id;
  if v_prs >= 1  then perform public.mint_achievement(new.user_id, 'pr_first'); end if;
  if v_prs >= 10 then perform public.mint_achievement(new.user_id, 'pr_10');   end if;
  if v_prs >= 25 then perform public.mint_achievement(new.user_id, 'pr_25');   end if;

  return new;
end;
$$;
revoke all on function public.tg_mint_workout_achievements() from public, anon, authenticated;

drop trigger if exists trg_mint_workout_achievements on public.workout_sessions;
create trigger trg_mint_workout_achievements
  after insert or update of status on public.workout_sessions
  for each row execute function public.tg_mint_workout_achievements();

-- ── body trophies: InBody count + body-comp deltas + goal + tier ─────────────
-- AFTER INSERT OR UPDATE (NOT `update of verified_at` — verified_at is written by the
-- BEFORE stamp trigger 0026, which `update of` would not observe). Fires once, on first
-- verification (insert verified, or null→not-null update).
create or replace function public.tg_mint_body_achievements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count  integer;
  v_base   record;
  v_target integer;
  v_sex    text;
  v_height numeric;
  v_ffmi   numeric;
  v_tier   text;
begin
  if new.verified_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.verified_at is not null then return new; end if;  -- already verified

  select count(*) into v_count
  from public.body_metrics
  where user_id = new.user_id and verified_at is not null;
  if v_count >= 1  then perform public.mint_achievement(new.user_id, 'first_inbody', jsonb_build_object('metric_id', new.id)); end if;
  if v_count >= 10 then perform public.mint_achievement(new.user_id, 'inbody_10'); end if;

  -- Body-comp deltas vs the EARLIEST verified reading (baseline).
  select m.body_fat_bp, m.skeletal_muscle_mass_grams into v_base
  from public.body_metrics m
  where m.user_id = new.user_id and m.verified_at is not null
  order by m.measured_at asc, m.created_at asc
  limit 1;

  if v_base.body_fat_bp is not null and new.body_fat_bp is not null then
    if new.body_fat_bp <= v_base.body_fat_bp - 100 then perform public.mint_achievement(new.user_id, 'body_fat_drop_1'); end if;
    if new.body_fat_bp <= v_base.body_fat_bp - 500 then perform public.mint_achievement(new.user_id, 'body_fat_drop_5'); end if;
  end if;
  if v_base.skeletal_muscle_mass_grams is not null and new.skeletal_muscle_mass_grams is not null then
    if new.skeletal_muscle_mass_grams >= v_base.skeletal_muscle_mass_grams + 1000 then perform public.mint_achievement(new.user_id, 'lean_gain_1kg'); end if;
    if new.skeletal_muscle_mass_grams >= v_base.skeletal_muscle_mass_grams + 5000 then perform public.mint_achievement(new.user_id, 'lean_gain_5kg'); end if;
  end if;

  -- Goal hit (latest weight within 2 kg of target) + tier (from this verified reading).
  select ap.target_weight_grams, ap.sex::text, ap.height_cm
    into v_target, v_sex, v_height
  from public.athlete_profile ap
  where ap.user_id = new.user_id;

  if v_target is not null and new.weight_grams is not null
     and abs(new.weight_grams - v_target) <= 2000 then
    perform public.mint_achievement(new.user_id, 'goal_hit',
      jsonb_build_object('target', v_target, 'actual', new.weight_grams));
  end if;

  if new.body_fat_bp is not null and v_height is not null and v_sex in ('male', 'female') then
    v_ffmi := public.compute_ffmi(new.weight_grams, new.body_fat_bp, v_height);
    v_tier := public.ffmi_tier(v_ffmi, v_sex);
    if v_tier is not null then
      perform public.mint_achievement(new.user_id, 'tier_' || v_tier, jsonb_build_object('ffmi', v_ffmi));
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public.tg_mint_body_achievements() from public, anon, authenticated;

drop trigger if exists trg_mint_body_achievements on public.body_metrics;
create trigger trg_mint_body_achievements
  after insert or update on public.body_metrics
  for each row execute function public.tg_mint_body_achievements();

-- ── get_public_app_achievements: field-allowlist public read ─────────────────
-- A user's trophies, visible to anyone when their profile is public (covers coaches AND
-- athletes via is_public_profile). Body-derived trophies are additionally gated behind
-- share_body_metrics_publicly (consent completeness — they reveal body-comp progress).
-- The owner always sees all of their own.
create or replace function public.get_public_app_achievements(p_user_id uuid)
returns table (achievement_key text, awarded_at timestamptz, metadata jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select a.achievement_key, a.awarded_at, a.metadata
  from public.app_achievements a
  where a.user_id = p_user_id
    and (public.is_public_profile(p_user_id) or a.user_id = auth.uid())
    and (
      a.user_id = auth.uid()
      or exists (
        select 1 from public.athlete_profile ap
        where ap.user_id = p_user_id and ap.share_body_metrics_publicly
      )
      or (
        a.achievement_key not like 'tier_%'
        and a.achievement_key not like 'body_fat_%'
        and a.achievement_key not like 'lean_gain_%'
        and a.achievement_key not in ('first_inbody', 'inbody_10', 'goal_hit')
      )
    )
  order by a.awarded_at desc;
$$;
revoke all on function public.get_public_app_achievements(uuid) from public, anon;
grant execute on function public.get_public_app_achievements(uuid) to authenticated, service_role;

-- ── one-time idempotent backfill ─────────────────────────────────────────────
-- Triggers only fire on NEW rows, but the pilot data (and any real users) already exist,
-- so without this their trophy cases would be empty. Every insert is `on conflict do
-- nothing`, so this is safe to re-run and is a no-op in the harness (seed.sql is applied
-- AFTER migrations, so there's no data here yet — it lights up only on a real DB).

-- Workout volume.
insert into public.app_achievements (user_id, achievement_key)
select s.user_id, k.key
from (
  select user_id, count(*) as n
  from public.workout_sessions where status = 'completed'
  group by user_id
) s
cross join lateral (values ('first_workout', 1), ('workouts_10', 10), ('workouts_50', 50), ('workouts_100', 100)) as k(key, threshold)
where s.n >= k.threshold
on conflict (user_id, achievement_key) do nothing;

-- Streak.
insert into public.app_achievements (user_id, achievement_key)
select u.user_id, k.key
from (select distinct user_id from public.workout_sessions where status = 'completed') u
cross join lateral (values ('streak_7', 7), ('streak_30', 30), ('streak_100', 100)) as k(key, threshold)
where public.current_streak(u.user_id) >= k.threshold
on conflict (user_id, achievement_key) do nothing;

-- PRs (distinct exercises with a recorded best).
insert into public.app_achievements (user_id, achievement_key)
select pc.user_id, k.key
from (select user_id, count(*) as n from public.v_exercise_prs group by user_id) pc
cross join lateral (values ('pr_first', 1), ('pr_10', 10), ('pr_25', 25)) as k(key, threshold)
where pc.n >= k.threshold
on conflict (user_id, achievement_key) do nothing;

-- InBody count.
insert into public.app_achievements (user_id, achievement_key)
select bc.user_id, k.key
from (select user_id, count(*) as n from public.body_metrics where verified_at is not null group by user_id) bc
cross join lateral (values ('first_inbody', 1), ('inbody_10', 10)) as k(key, threshold)
where bc.n >= k.threshold
on conflict (user_id, achievement_key) do nothing;

-- Body-comp deltas (baseline = earliest verified, latest = latest verified).
with verified as (
  select user_id, measured_at, created_at, body_fat_bp, skeletal_muscle_mass_grams, weight_grams
  from public.body_metrics where verified_at is not null
),
baseline as (
  select distinct on (user_id) user_id, body_fat_bp, skeletal_muscle_mass_grams
  from verified order by user_id, measured_at asc, created_at asc
),
latest as (
  select distinct on (user_id) user_id, body_fat_bp, skeletal_muscle_mass_grams, weight_grams
  from verified order by user_id, measured_at desc, created_at desc
)
insert into public.app_achievements (user_id, achievement_key)
select b.user_id, v.key
from baseline b
join latest l on l.user_id = b.user_id
cross join lateral (values ('body_fat_drop_1'), ('body_fat_drop_5'), ('lean_gain_1kg'), ('lean_gain_5kg')) as v(key)
where case v.key
  when 'body_fat_drop_1' then b.body_fat_bp is not null and l.body_fat_bp is not null and l.body_fat_bp <= b.body_fat_bp - 100
  when 'body_fat_drop_5' then b.body_fat_bp is not null and l.body_fat_bp is not null and l.body_fat_bp <= b.body_fat_bp - 500
  when 'lean_gain_1kg'   then b.skeletal_muscle_mass_grams is not null and l.skeletal_muscle_mass_grams is not null and l.skeletal_muscle_mass_grams >= b.skeletal_muscle_mass_grams + 1000
  when 'lean_gain_5kg'   then b.skeletal_muscle_mass_grams is not null and l.skeletal_muscle_mass_grams is not null and l.skeletal_muscle_mass_grams >= b.skeletal_muscle_mass_grams + 5000
end
on conflict (user_id, achievement_key) do nothing;

-- Goal hit + tier (from each user's latest verified reading).
with latest as (
  select distinct on (m.user_id) m.user_id, m.weight_grams, m.body_fat_bp
  from public.body_metrics m where m.verified_at is not null
  order by m.user_id, m.measured_at desc, m.created_at desc
)
insert into public.app_achievements (user_id, achievement_key)
select l.user_id, 'goal_hit'
from latest l
join public.athlete_profile ap on ap.user_id = l.user_id
where ap.target_weight_grams is not null and l.weight_grams is not null
  and abs(l.weight_grams - ap.target_weight_grams) <= 2000
on conflict (user_id, achievement_key) do nothing;

with latest as (
  select distinct on (m.user_id) m.user_id, m.weight_grams, m.body_fat_bp
  from public.body_metrics m where m.verified_at is not null
  order by m.user_id, m.measured_at desc, m.created_at desc
)
insert into public.app_achievements (user_id, achievement_key)
select l.user_id, 'tier_' || public.ffmi_tier(public.compute_ffmi(l.weight_grams, l.body_fat_bp, ap.height_cm), ap.sex::text)
from latest l
join public.athlete_profile ap on ap.user_id = l.user_id
where l.body_fat_bp is not null and ap.height_cm is not null and ap.sex::text in ('male', 'female')
  and public.compute_ffmi(l.weight_grams, l.body_fat_bp, ap.height_cm) is not null
on conflict (user_id, achievement_key) do nothing;
