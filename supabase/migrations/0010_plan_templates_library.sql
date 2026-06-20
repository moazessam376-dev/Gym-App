-- 0010_plan_templates_library.sql
--
-- Phase 3 (v2): turn plans into coach-owned TEMPLATES + a shared exercise/food
-- LIBRARY, with separate training (days → block-labelled exercises) and
-- nutrition (meals → food items) structures. Assigning a template to a client
-- deep-copies it (assign_plan_to_client). Same deny-by-default tenancy (§2):
-- a coach owns templates + their clients' assigned copies; a client reads only
-- their own assigned, non-draft plan. Evolves 0009 (which stays in history).
-- Idempotent so it can be re-pasted into the SQL editor.

-- ── Enums ─────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'training_block') then
    create type public.training_block as enum
      ('warmup', 'primary', 'accessory', 'conditioning', 'cooldown');
  end if;
  if not exists (select 1 from pg_type where typname = 'muscle_group') then
    create type public.muscle_group as enum
      ('push', 'pull', 'legs', 'upper', 'lower', 'core');
  end if;
end
$$;

-- ── Evolve plans: nullable client_id (NULL = template) + provenance ───────────
alter table public.plans alter column client_id drop not null;
alter table public.plans
  add column if not exists source_plan_id uuid references public.plans (id) on delete set null;

-- A template has no client; an assigned plan must not point coach at themselves.
alter table public.plans drop constraint if exists plans_coach_not_client;
alter table public.plans
  add constraint plans_coach_not_client check (client_id is null or coach_id <> client_id);

create index if not exists plans_source_plan_id_idx on public.plans (source_plan_id);
create index if not exists plans_templates_idx on public.plans (coach_id) where client_id is null;

-- Insert/update now allow templates (client_id IS NULL); is_coach_of only checked
-- when actually assigning. is_coach_of(null) is false, hence the IS NULL branch.
drop policy if exists plans_insert on public.plans;
create policy plans_insert on public.plans
  for insert to authenticated
  with check (
    coach_id = auth.uid()
    and public.current_app_role() = 'coach'
    and (client_id is null or public.is_coach_of(client_id))
  );

drop policy if exists plans_update on public.plans;
create policy plans_update on public.plans
  for update to authenticated
  using (coach_id = auth.uid())
  with check (
    coach_id = auth.uid()
    and (client_id is null or public.is_coach_of(client_id))
  );
-- plans_select and plans_delete from 0009 are unchanged and stay correct: a
-- client can never match a template (client_id NULL), and can_read_plan /
-- can_write_plan (0009) are already NULL-safe and template-correct.

-- Retire the flat free-text items from 0009 — replaced by the structured tables
-- below (only test data existed). Its policies drop with it; the can_read_plan /
-- can_write_plan helpers are KEPT (reused by the new child tables).
drop table if exists public.plan_items cascade;

-- ── Exercise library (global = coach_id NULL, or coach-custom) ────────────────
create table if not exists public.exercise_library (
  id             uuid primary key default gen_random_uuid(),
  coach_id       uuid references public.profiles (id) on delete cascade,  -- NULL = global
  name           text not null,
  muscle_group   public.muscle_group not null,
  primary_muscle text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists exercise_library_coach_id_idx on public.exercise_library (coach_id);
create index if not exists exercise_library_muscle_group_idx on public.exercise_library (muscle_group);

alter table public.exercise_library enable row level security;

drop trigger if exists exercise_library_set_updated_at on public.exercise_library;
create trigger exercise_library_set_updated_at
  before update on public.exercise_library
  for each row execute function public.set_updated_at();

-- Read globals + your own customs (+ admin). Coaches never see another coach's
-- custom entries. Writes are limited to your OWN customs: coach_id must equal
-- auth.uid(), so a coach can't forge a global (NULL) or another coach's row.
drop policy if exists exercise_library_select on public.exercise_library;
create policy exercise_library_select on public.exercise_library
  for select to authenticated
  using (coach_id is null or coach_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists exercise_library_insert on public.exercise_library;
create policy exercise_library_insert on public.exercise_library
  for insert to authenticated
  with check (coach_id = auth.uid() and public.current_app_role() = 'coach');

drop policy if exists exercise_library_update on public.exercise_library;
create policy exercise_library_update on public.exercise_library
  for update to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

drop policy if exists exercise_library_delete on public.exercise_library;
create policy exercise_library_delete on public.exercise_library
  for delete to authenticated
  using (coach_id = auth.uid());

grant select, insert, update, delete on public.exercise_library to authenticated;
grant select on public.exercise_library to anon;  -- RLS -> 0 rows for anon

-- ── Food library (global or coach-custom). Macros are INTEGERS (money.md) ─────
create table if not exists public.food_library (
  id                 uuid primary key default gen_random_uuid(),
  coach_id           uuid references public.profiles (id) on delete cascade,  -- NULL = global
  name               text not null,
  kcal_per_100g      integer not null check (kcal_per_100g >= 0),
  protein_g_per_100g integer not null check (protein_g_per_100g >= 0),
  carbs_g_per_100g   integer not null check (carbs_g_per_100g >= 0),
  fat_g_per_100g     integer not null check (fat_g_per_100g >= 0),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists food_library_coach_id_idx on public.food_library (coach_id);

alter table public.food_library enable row level security;

drop trigger if exists food_library_set_updated_at on public.food_library;
create trigger food_library_set_updated_at
  before update on public.food_library
  for each row execute function public.set_updated_at();

drop policy if exists food_library_select on public.food_library;
create policy food_library_select on public.food_library
  for select to authenticated
  using (coach_id is null or coach_id = auth.uid() or public.current_app_role() = 'admin');

drop policy if exists food_library_insert on public.food_library;
create policy food_library_insert on public.food_library
  for insert to authenticated
  with check (coach_id = auth.uid() and public.current_app_role() = 'coach');

drop policy if exists food_library_update on public.food_library;
create policy food_library_update on public.food_library
  for update to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid());

drop policy if exists food_library_delete on public.food_library;
create policy food_library_delete on public.food_library
  for delete to authenticated
  using (coach_id = auth.uid());

grant select, insert, update, delete on public.food_library to authenticated;
grant select on public.food_library to anon;

-- ── Training: plan_days → plan_exercises ─────────────────────────────────────
create table if not exists public.plan_days (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans (id) on delete cascade,
  position   integer not null default 0 check (position >= 0),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_days_plan_id_idx on public.plan_days (plan_id);

alter table public.plan_days enable row level security;

drop trigger if exists plan_days_set_updated_at on public.plan_days;
create trigger plan_days_set_updated_at
  before update on public.plan_days
  for each row execute function public.set_updated_at();

-- Days hang off a plan directly → reuse the 0009 plan helpers.
drop policy if exists plan_days_select on public.plan_days;
create policy plan_days_select on public.plan_days
  for select to authenticated using (public.can_read_plan(plan_id));
drop policy if exists plan_days_insert on public.plan_days;
create policy plan_days_insert on public.plan_days
  for insert to authenticated with check (public.can_write_plan(plan_id));
drop policy if exists plan_days_update on public.plan_days;
create policy plan_days_update on public.plan_days
  for update to authenticated using (public.can_write_plan(plan_id)) with check (public.can_write_plan(plan_id));
drop policy if exists plan_days_delete on public.plan_days;
create policy plan_days_delete on public.plan_days
  for delete to authenticated using (public.can_write_plan(plan_id));

grant select, insert, update, delete on public.plan_days to authenticated;
grant select on public.plan_days to anon;

-- Grandchildren hold only day_id/meal_id, so they need helpers that resolve up to
-- the plan. SECURITY DEFINER (like is_coach_of) so the policy doesn't re-enter the
-- parent table's RLS and recurse. Pinned search_path; schema-qualified.
create or replace function public.can_read_day(p_day uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plan_days d
    where d.id = p_day and public.can_read_plan(d.plan_id)
  )
$$;

create or replace function public.can_write_day(p_day uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plan_days d
    where d.id = p_day and public.can_write_plan(d.plan_id)
  )
$$;

revoke all on function public.can_read_day(uuid)  from public;
revoke all on function public.can_write_day(uuid) from public;
revoke execute on function public.can_read_day(uuid)  from anon;
revoke execute on function public.can_write_day(uuid) from anon;
grant execute on function public.can_read_day(uuid)  to authenticated, service_role;
grant execute on function public.can_write_day(uuid) to authenticated, service_role;

create table if not exists public.plan_exercises (
  id           uuid primary key default gen_random_uuid(),
  day_id       uuid not null references public.plan_days (id) on delete cascade,
  exercise_id  uuid not null references public.exercise_library (id) on delete restrict,
  block        public.training_block not null default 'primary',
  position     integer not null default 0 check (position >= 0),
  sets         integer check (sets is null or sets >= 0),
  reps         text,                 -- ranges like "8-12"; validated by Zod
  rest_seconds integer check (rest_seconds is null or rest_seconds >= 0),  -- integer, never float
  tempo        text,
  note         text,                 -- coach comment for the trainee
  progression  jsonb not null default '{}'::jsonb,  -- reserved for the later engine; unused now
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists plan_exercises_day_id_idx on public.plan_exercises (day_id);
create index if not exists plan_exercises_exercise_id_idx on public.plan_exercises (exercise_id);

alter table public.plan_exercises enable row level security;

drop trigger if exists plan_exercises_set_updated_at on public.plan_exercises;
create trigger plan_exercises_set_updated_at
  before update on public.plan_exercises
  for each row execute function public.set_updated_at();

drop policy if exists plan_exercises_select on public.plan_exercises;
create policy plan_exercises_select on public.plan_exercises
  for select to authenticated using (public.can_read_day(day_id));
drop policy if exists plan_exercises_insert on public.plan_exercises;
create policy plan_exercises_insert on public.plan_exercises
  for insert to authenticated with check (public.can_write_day(day_id));
drop policy if exists plan_exercises_update on public.plan_exercises;
create policy plan_exercises_update on public.plan_exercises
  for update to authenticated using (public.can_write_day(day_id)) with check (public.can_write_day(day_id));
drop policy if exists plan_exercises_delete on public.plan_exercises;
create policy plan_exercises_delete on public.plan_exercises
  for delete to authenticated using (public.can_write_day(day_id));

grant select, insert, update, delete on public.plan_exercises to authenticated;
grant select on public.plan_exercises to anon;

-- ── Nutrition: plan_meals → plan_meal_items ──────────────────────────────────
create table if not exists public.plan_meals (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans (id) on delete cascade,
  position   integer not null default 0 check (position >= 0),
  name       text not null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_meals_plan_id_idx on public.plan_meals (plan_id);

alter table public.plan_meals enable row level security;

drop trigger if exists plan_meals_set_updated_at on public.plan_meals;
create trigger plan_meals_set_updated_at
  before update on public.plan_meals
  for each row execute function public.set_updated_at();

drop policy if exists plan_meals_select on public.plan_meals;
create policy plan_meals_select on public.plan_meals
  for select to authenticated using (public.can_read_plan(plan_id));
drop policy if exists plan_meals_insert on public.plan_meals;
create policy plan_meals_insert on public.plan_meals
  for insert to authenticated with check (public.can_write_plan(plan_id));
drop policy if exists plan_meals_update on public.plan_meals;
create policy plan_meals_update on public.plan_meals
  for update to authenticated using (public.can_write_plan(plan_id)) with check (public.can_write_plan(plan_id));
drop policy if exists plan_meals_delete on public.plan_meals;
create policy plan_meals_delete on public.plan_meals
  for delete to authenticated using (public.can_write_plan(plan_id));

grant select, insert, update, delete on public.plan_meals to authenticated;
grant select on public.plan_meals to anon;

create or replace function public.can_read_meal(p_meal uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plan_meals m
    where m.id = p_meal and public.can_read_plan(m.plan_id)
  )
$$;

create or replace function public.can_write_meal(p_meal uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.plan_meals m
    where m.id = p_meal and public.can_write_plan(m.plan_id)
  )
$$;

revoke all on function public.can_read_meal(uuid)  from public;
revoke all on function public.can_write_meal(uuid) from public;
revoke execute on function public.can_read_meal(uuid)  from anon;
revoke execute on function public.can_write_meal(uuid) from anon;
grant execute on function public.can_read_meal(uuid)  to authenticated, service_role;
grant execute on function public.can_write_meal(uuid) to authenticated, service_role;

create table if not exists public.plan_meal_items (
  id         uuid primary key default gen_random_uuid(),
  meal_id    uuid not null references public.plan_meals (id) on delete cascade,
  food_id    uuid not null references public.food_library (id) on delete restrict,
  position   integer not null default 0 check (position >= 0),
  grams      integer not null check (grams >= 0),  -- integer, never float
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_meal_items_meal_id_idx on public.plan_meal_items (meal_id);
create index if not exists plan_meal_items_food_id_idx on public.plan_meal_items (food_id);

alter table public.plan_meal_items enable row level security;

drop trigger if exists plan_meal_items_set_updated_at on public.plan_meal_items;
create trigger plan_meal_items_set_updated_at
  before update on public.plan_meal_items
  for each row execute function public.set_updated_at();

drop policy if exists plan_meal_items_select on public.plan_meal_items;
create policy plan_meal_items_select on public.plan_meal_items
  for select to authenticated using (public.can_read_meal(meal_id));
drop policy if exists plan_meal_items_insert on public.plan_meal_items;
create policy plan_meal_items_insert on public.plan_meal_items
  for insert to authenticated with check (public.can_write_meal(meal_id));
drop policy if exists plan_meal_items_update on public.plan_meal_items;
create policy plan_meal_items_update on public.plan_meal_items
  for update to authenticated using (public.can_write_meal(meal_id)) with check (public.can_write_meal(meal_id));
drop policy if exists plan_meal_items_delete on public.plan_meal_items;
create policy plan_meal_items_delete on public.plan_meal_items
  for delete to authenticated using (public.can_write_meal(meal_id));

grant select, insert, update, delete on public.plan_meal_items to authenticated;
grant select on public.plan_meal_items to anon;

-- ── Assign a template to a client: deep-copy into a new draft plan ───────────
-- SECURITY INVOKER (not service-role-only like assign_client): it touches only
-- plan-domain tables the coach already controls via RLS — never ownership/role/
-- billing — so RLS enforces correctness as defense in depth. Guards give clean
-- generic errors. The whole body is one transaction (atomic). Library rows are
-- referenced, not copied.
create or replace function public.assign_plan_to_client(p_template uuid, p_client uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_type  public.plan_type;
  v_title text;
  v_new   uuid;
begin
  -- The template must be the caller's own, unassigned plan.
  select type, title
    into v_type, v_title
    from public.plans
   where id = p_template
     and coach_id = auth.uid()
     and client_id is null;
  if not found then
    raise exception 'assign_invalid' using errcode = 'P0001';
  end if;

  -- The target must be the caller's client.
  if not public.is_coach_of(p_client) then
    raise exception 'assign_invalid' using errcode = 'P0001';
  end if;

  insert into public.plans (coach_id, client_id, type, title, status, source_plan_id)
  values (auth.uid(), p_client, v_type, v_title, 'draft', p_template)
  returning id into v_new;

  if v_type = 'training' then
    with src as (
      select id as old_id, position, name, gen_random_uuid() as new_id
      from public.plan_days
      where plan_id = p_template
    ),
    ins_days as (
      insert into public.plan_days (id, plan_id, position, name)
      select new_id, v_new, position, name from src
      returning 1
    )
    insert into public.plan_exercises
      (day_id, exercise_id, block, position, sets, reps, rest_seconds, tempo, note, progression)
    select s.new_id, e.exercise_id, e.block, e.position, e.sets, e.reps,
           e.rest_seconds, e.tempo, e.note, e.progression
    from public.plan_exercises e
    join src s on s.old_id = e.day_id;
  else
    with src as (
      select id as old_id, position, name, note, gen_random_uuid() as new_id
      from public.plan_meals
      where plan_id = p_template
    ),
    ins_meals as (
      insert into public.plan_meals (id, plan_id, position, name, note)
      select new_id, v_new, position, name, note from src
      returning 1
    )
    insert into public.plan_meal_items (meal_id, food_id, position, grams, note)
    select s.new_id, mi.food_id, mi.position, mi.grams, mi.note
    from public.plan_meal_items mi
    join src s on s.old_id = mi.meal_id;
  end if;

  return v_new;
end;
$$;

revoke all on function public.assign_plan_to_client(uuid, uuid) from public, anon;
grant execute on function public.assign_plan_to_client(uuid, uuid) to authenticated, service_role;

-- ── Seed: global exercise + food library (real data; coach_id NULL) ──────────
-- Fixed UUIDs + on-conflict so re-applying is safe. These are platform globals
-- every coach can read and pull into plans.
insert into public.exercise_library (id, coach_id, name, muscle_group, primary_muscle) values
  ('e0000000-0000-0000-0000-000000000001', null, 'Barbell Bench Press',      'push',  'chest'),
  ('e0000000-0000-0000-0000-000000000002', null, 'Incline Dumbbell Press',   'push',  'upper chest'),
  ('e0000000-0000-0000-0000-000000000003', null, 'Overhead Press',           'push',  'shoulders'),
  ('e0000000-0000-0000-0000-000000000004', null, 'Dumbbell Shoulder Press',  'push',  'shoulders'),
  ('e0000000-0000-0000-0000-000000000005', null, 'Cable Fly',                'push',  'chest'),
  ('e0000000-0000-0000-0000-000000000006', null, 'Triceps Pushdown',         'push',  'triceps'),
  ('e0000000-0000-0000-0000-000000000007', null, 'Overhead Triceps Extension','push', 'triceps'),
  ('e0000000-0000-0000-0000-000000000008', null, 'Dips',                     'push',  'chest'),
  ('e0000000-0000-0000-0000-000000000009', null, 'Lateral Raise',            'push',  'side delts'),
  ('e0000000-0000-0000-0000-00000000000a', null, 'Deadlift',                 'pull',  'back'),
  ('e0000000-0000-0000-0000-00000000000b', null, 'Pull-up',                  'pull',  'lats'),
  ('e0000000-0000-0000-0000-00000000000c', null, 'Lat Pulldown',             'pull',  'lats'),
  ('e0000000-0000-0000-0000-00000000000d', null, 'Barbell Row',              'pull',  'back'),
  ('e0000000-0000-0000-0000-00000000000e', null, 'Seated Cable Row',         'pull',  'back'),
  ('e0000000-0000-0000-0000-00000000000f', null, 'Face Pull',                'pull',  'rear delts'),
  ('e0000000-0000-0000-0000-000000000010', null, 'Barbell Curl',             'pull',  'biceps'),
  ('e0000000-0000-0000-0000-000000000011', null, 'Dumbbell Curl',            'pull',  'biceps'),
  ('e0000000-0000-0000-0000-000000000012', null, 'Hammer Curl',              'pull',  'biceps'),
  ('e0000000-0000-0000-0000-000000000013', null, 'Back Squat',               'legs',  'quads'),
  ('e0000000-0000-0000-0000-000000000014', null, 'Front Squat',              'legs',  'quads'),
  ('e0000000-0000-0000-0000-000000000015', null, 'Romanian Deadlift',        'legs',  'hamstrings'),
  ('e0000000-0000-0000-0000-000000000016', null, 'Leg Press',                'legs',  'quads'),
  ('e0000000-0000-0000-0000-000000000017', null, 'Leg Curl',                 'legs',  'hamstrings'),
  ('e0000000-0000-0000-0000-000000000018', null, 'Leg Extension',            'legs',  'quads'),
  ('e0000000-0000-0000-0000-000000000019', null, 'Walking Lunge',            'legs',  'quads'),
  ('e0000000-0000-0000-0000-00000000001a', null, 'Standing Calf Raise',      'legs',  'calves'),
  ('e0000000-0000-0000-0000-00000000001b', null, 'Hip Thrust',               'legs',  'glutes'),
  ('e0000000-0000-0000-0000-00000000001c', null, 'Push-up',                  'upper', 'chest'),
  ('e0000000-0000-0000-0000-00000000001d', null, 'Chin-up',                  'upper', 'back'),
  ('e0000000-0000-0000-0000-00000000001e', null, 'Arnold Press',             'upper', 'shoulders'),
  ('e0000000-0000-0000-0000-00000000001f', null, 'Incline Barbell Press',    'upper', 'upper chest'),
  ('e0000000-0000-0000-0000-000000000020', null, 'Goblet Squat',             'lower', 'quads'),
  ('e0000000-0000-0000-0000-000000000021', null, 'Bulgarian Split Squat',    'lower', 'quads'),
  ('e0000000-0000-0000-0000-000000000022', null, 'Glute Bridge',             'lower', 'glutes'),
  ('e0000000-0000-0000-0000-000000000023', null, 'Seated Leg Curl',          'lower', 'hamstrings'),
  ('e0000000-0000-0000-0000-000000000024', null, 'Plank',                    'core',  'abs'),
  ('e0000000-0000-0000-0000-000000000025', null, 'Hanging Leg Raise',        'core',  'abs'),
  ('e0000000-0000-0000-0000-000000000026', null, 'Cable Crunch',             'core',  'abs'),
  ('e0000000-0000-0000-0000-000000000027', null, 'Russian Twist',            'core',  'obliques'),
  ('e0000000-0000-0000-0000-000000000028', null, 'Ab Wheel Rollout',         'core',  'abs')
on conflict (id) do nothing;

insert into public.food_library
  (id, coach_id, name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g) values
  ('f0000000-0000-0000-0000-000000000001', null, 'Chicken Breast (cooked)',     165, 31,  0,  4),
  ('f0000000-0000-0000-0000-000000000002', null, 'Lean Beef Mince (cooked)',    250, 26,  0, 15),
  ('f0000000-0000-0000-0000-000000000003', null, 'Salmon (cooked)',             208, 20,  0, 13),
  ('f0000000-0000-0000-0000-000000000004', null, 'White Rice (cooked)',         130,  3, 28,  0),
  ('f0000000-0000-0000-0000-000000000005', null, 'Brown Rice (cooked)',         123,  3, 26,  1),
  ('f0000000-0000-0000-0000-000000000006', null, 'Rolled Oats (dry)',           389, 17, 66,  7),
  ('f0000000-0000-0000-0000-000000000007', null, 'Whole Egg',                   155, 13,  1, 11),
  ('f0000000-0000-0000-0000-000000000008', null, 'Egg White',                    52, 11,  1,  0),
  ('f0000000-0000-0000-0000-000000000009', null, 'Greek Yogurt (0%)',            59, 10,  4,  0),
  ('f0000000-0000-0000-0000-00000000000a', null, 'Whole Milk',                   61,  3,  5,  3),
  ('f0000000-0000-0000-0000-00000000000b', null, 'Sweet Potato (cooked)',        90,  2, 21,  0),
  ('f0000000-0000-0000-0000-00000000000c', null, 'Potato (cooked)',              87,  2, 20,  0),
  ('f0000000-0000-0000-0000-00000000000d', null, 'Banana',                       89,  1, 23,  0),
  ('f0000000-0000-0000-0000-00000000000e', null, 'Apple',                        52,  0, 14,  0),
  ('f0000000-0000-0000-0000-00000000000f', null, 'Broccoli',                     34,  3,  7,  0),
  ('f0000000-0000-0000-0000-000000000010', null, 'Almonds',                     579, 21, 22, 50),
  ('f0000000-0000-0000-0000-000000000011', null, 'Peanut Butter',               588, 25, 20, 50),
  ('f0000000-0000-0000-0000-000000000012', null, 'Olive Oil',                   884,  0,  0,100),
  ('f0000000-0000-0000-0000-000000000013', null, 'Avocado',                     160,  2,  9, 15),
  ('f0000000-0000-0000-0000-000000000014', null, 'Whey Protein (powder)',       400, 80,  8,  6),
  ('f0000000-0000-0000-0000-000000000015', null, 'Tuna (canned in water)',      116, 26,  0,  1),
  ('f0000000-0000-0000-0000-000000000016', null, 'Cottage Cheese',               98, 11,  3,  4),
  ('f0000000-0000-0000-0000-000000000017', null, 'Lentils (cooked)',            116,  9, 20,  0),
  ('f0000000-0000-0000-0000-000000000018', null, 'Chickpeas (cooked)',          164,  9, 27,  3),
  ('f0000000-0000-0000-0000-000000000019', null, 'Pasta (cooked)',              158,  6, 31,  1),
  ('f0000000-0000-0000-0000-00000000001a', null, 'Whole Wheat Bread',           247, 13, 41,  3),
  ('f0000000-0000-0000-0000-00000000001b', null, 'Tofu',                         76,  8,  2,  5),
  ('f0000000-0000-0000-0000-00000000001c', null, 'Shrimp (cooked)',              99, 24,  0,  1),
  ('f0000000-0000-0000-0000-00000000001d', null, 'Quinoa (cooked)',             120,  4, 21,  2),
  ('f0000000-0000-0000-0000-00000000001e', null, 'Honey',                       304,  0, 82,  0)
on conflict (id) do nothing;
