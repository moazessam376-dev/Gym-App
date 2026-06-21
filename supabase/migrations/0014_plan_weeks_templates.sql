-- 0014_plan_weeks_templates.sql
--
-- Plans v3: add a WEEK layer to training plans (Plan → Weeks → Days → Exercises),
-- 3-level coach comments (plan / day / exercise), and SYSTEM TEMPLATES (global
-- plans every coach can clone). Same deny-by-default tenancy (§2). Idempotent.
--
-- Design (low-risk): weeks are an ORGANIZING layer, not a re-parent. plan_days
-- keeps plan_id (so can_read_day/can_write_day from 0010 are unchanged) and GAINS
-- week_id, with a COMPOSITE FK (week_id, plan_id) → plan_weeks(id, plan_id) that
-- guarantees a day's week belongs to the day's plan. Only training plans use
-- weeks; nutrition stays Plan → Meals → Items.

-- ── plans: nullable coach_id (system templates) + a plan-level comment ────────
-- A system template is a global plan: coach_id IS NULL and client_id IS NULL.
-- Forging one is impossible — plans_insert/_update require coach_id = auth.uid().
alter table public.plans alter column coach_id drop not null;
alter table public.plans add column if not exists note text;  -- plan-level comment

-- Let a coach READ (browse + clone) global system templates. Writes still require
-- coach_id = auth.uid(), so globals stay read-only. Mirrors the global library.
create or replace function public.can_read_plan(p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.plans p
    where p.id = p_plan
      and (
        p.coach_id = auth.uid()
        or (p.client_id = auth.uid() and p.status <> 'draft')
        or (p.coach_id is null and p.client_id is null and public.current_app_role() = 'coach')
        or public.current_app_role() = 'admin'
      )
  )
$$;

drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated
  using (
    coach_id = auth.uid()
    or (client_id = auth.uid() and status <> 'draft')
    or (coach_id is null and client_id is null and public.current_app_role() = 'coach')
    or public.current_app_role() = 'admin'
  );

-- ── plan_weeks (training only) ───────────────────────────────────────────────
create table if not exists public.plan_weeks (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans (id) on delete cascade,
  position   integer not null default 0 check (position >= 0),
  name       text not null,
  note       text,                                  -- week-level comment
  created_at timestamptz not null default now(),    -- UTC (§11)
  updated_at timestamptz not null default now(),
  unique (id, plan_id)                              -- composite-FK target for plan_days
);
create index if not exists plan_weeks_plan_id_idx on public.plan_weeks (plan_id);

alter table public.plan_weeks enable row level security;

drop trigger if exists plan_weeks_set_updated_at on public.plan_weeks;
create trigger plan_weeks_set_updated_at
  before update on public.plan_weeks
  for each row execute function public.set_updated_at();

-- Weeks hang off a plan → reuse the 0009 plan helpers (can_read/can_write_plan).
drop policy if exists plan_weeks_select on public.plan_weeks;
create policy plan_weeks_select on public.plan_weeks
  for select to authenticated using (public.can_read_plan(plan_id));
drop policy if exists plan_weeks_insert on public.plan_weeks;
create policy plan_weeks_insert on public.plan_weeks
  for insert to authenticated with check (public.can_write_plan(plan_id));
drop policy if exists plan_weeks_update on public.plan_weeks;
create policy plan_weeks_update on public.plan_weeks
  for update to authenticated using (public.can_write_plan(plan_id)) with check (public.can_write_plan(plan_id));
drop policy if exists plan_weeks_delete on public.plan_weeks;
create policy plan_weeks_delete on public.plan_weeks
  for delete to authenticated using (public.can_write_plan(plan_id));

grant select, insert, update, delete on public.plan_weeks to authenticated;
grant select on public.plan_weeks to anon;  -- RLS -> 0 rows

-- ── plan_days: week_id + day-level comment + composite FK ─────────────────────
alter table public.plan_days add column if not exists week_id uuid;
alter table public.plan_days add column if not exists note text;  -- day-level comment

-- Backfill: give every plan that already has days a "Week 1" and point its days
-- at it (only null-week rows, so re-applying is a no-op).
do $$
declare r record; v_week uuid;
begin
  for r in select distinct plan_id from public.plan_days where week_id is null loop
    select id into v_week from public.plan_weeks where plan_id = r.plan_id order by position limit 1;
    if v_week is null then
      insert into public.plan_weeks (plan_id, position, name) values (r.plan_id, 0, 'Week 1') returning id into v_week;
    end if;
    update public.plan_days set week_id = v_week where plan_id = r.plan_id and week_id is null;
  end loop;
end
$$;

-- Composite FK (added after backfill so existing rows satisfy it). Guards a day's
-- week to the day's own plan. Guarded create for idempotent re-apply.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plan_days_week_fk') then
    alter table public.plan_days
      add constraint plan_days_week_fk
      foreign key (week_id, plan_id) references public.plan_weeks (id, plan_id) on delete cascade;
  end if;
end
$$;

alter table public.plan_days alter column week_id set not null;  -- every day lives in a week
create index if not exists plan_days_week_id_idx on public.plan_days (week_id);

-- ── clone_template: copy a template (own OR global) into a NEW editable copy ──
-- SECURITY INVOKER (like assign_plan_to_client): touches only plan-domain tables
-- the coach controls via RLS. Produces a coach-owned template (client_id null) the
-- coach can then edit + assign. Separate insert statements in a loop (NOT a
-- data-modifying CTE — child RLS/FK must see the just-inserted parent; see 0010).
create or replace function public.clone_template(p_template uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_type public.plan_type; v_title text; v_note text; v_new uuid;
  r_week record; v_new_week uuid; r_day record; v_new_day uuid; r_meal record; v_new_meal uuid;
begin
  if public.current_app_role() <> 'coach' then
    raise exception 'clone_invalid' using errcode = 'P0001';
  end if;
  -- Source must be a template (client_id null) the caller can READ (own or global).
  select type, title, note into v_type, v_title, v_note
    from public.plans
   where id = p_template and client_id is null and public.can_read_plan(id);
  if not found then
    raise exception 'clone_invalid' using errcode = 'P0001';
  end if;

  insert into public.plans (coach_id, client_id, type, title, status, source_plan_id, note)
  values (auth.uid(), null, v_type, v_title, 'draft', p_template, v_note)
  returning id into v_new;

  if v_type = 'training' then
    for r_week in select id, position, name, note from public.plan_weeks where plan_id = p_template loop
      insert into public.plan_weeks (plan_id, position, name, note)
      values (v_new, r_week.position, r_week.name, r_week.note)
      returning id into v_new_week;
      for r_day in select id, position, name, note from public.plan_days where week_id = r_week.id loop
        insert into public.plan_days (plan_id, week_id, position, name, note)
        values (v_new, v_new_week, r_day.position, r_day.name, r_day.note)
        returning id into v_new_day;
        insert into public.plan_exercises
          (day_id, exercise_id, exercise_name, block, position, sets, reps, rest_seconds, tempo, note, progression)
        select v_new_day, e.exercise_id, e.exercise_name, e.block, e.position, e.sets, e.reps,
               e.rest_seconds, e.tempo, e.note, e.progression
        from public.plan_exercises e where e.day_id = r_day.id;
      end loop;
    end loop;
  else
    for r_meal in select id, position, name, note from public.plan_meals where plan_id = p_template loop
      insert into public.plan_meals (plan_id, position, name, note)
      values (v_new, r_meal.position, r_meal.name, r_meal.note)
      returning id into v_new_meal;
      insert into public.plan_meal_items
        (meal_id, food_id, food_name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, position, grams, note)
      select v_new_meal, mi.food_id, mi.food_name, mi.kcal_per_100g, mi.protein_g_per_100g,
             mi.carbs_g_per_100g, mi.fat_g_per_100g, mi.position, mi.grams, mi.note
      from public.plan_meal_items mi where mi.meal_id = r_meal.id;
    end loop;
  end if;

  return v_new;
end;
$$;
revoke all on function public.clone_template(uuid) from public, anon;
grant execute on function public.clone_template(uuid) to authenticated, service_role;

-- ── duplicate_plan_week: copy a week (+ its days/exercises) within its plan ───
create or replace function public.duplicate_plan_week(p_week uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_plan uuid; v_pos integer; v_new_week uuid; r_day record; v_new_day uuid;
begin
  select plan_id into v_plan from public.plan_weeks where id = p_week;
  if not found or not public.can_write_plan(v_plan) then
    raise exception 'duplicate_invalid' using errcode = 'P0001';
  end if;

  select coalesce(max(position), -1) + 1 into v_pos from public.plan_weeks where plan_id = v_plan;
  insert into public.plan_weeks (plan_id, position, name)
  values (v_plan, v_pos, 'Week ' || (v_pos + 1))
  returning id into v_new_week;

  for r_day in select id, position, name, note from public.plan_days where week_id = p_week loop
    insert into public.plan_days (plan_id, week_id, position, name, note)
    values (v_plan, v_new_week, r_day.position, r_day.name, r_day.note)
    returning id into v_new_day;
    insert into public.plan_exercises
      (day_id, exercise_id, exercise_name, block, position, sets, reps, rest_seconds, tempo, note, progression)
    select v_new_day, e.exercise_id, e.exercise_name, e.block, e.position, e.sets, e.reps,
           e.rest_seconds, e.tempo, e.note, e.progression
    from public.plan_exercises e where e.day_id = r_day.id;
  end loop;

  return v_new_week;
end;
$$;
revoke all on function public.duplicate_plan_week(uuid) from public, anon;
grant execute on function public.duplicate_plan_week(uuid) to authenticated, service_role;

-- ── assign_plan_to_client: now clones the WEEKS layer for training ───────────
create or replace function public.assign_plan_to_client(p_template uuid, p_client uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_type    public.plan_type;
  v_title   text;
  v_note    text;
  v_new     uuid;
  r_week    record;
  v_new_week uuid;
  r_day     record;
  r_meal    record;
  v_new_day uuid;
  v_new_meal uuid;
begin
  -- The template must be the caller's own, unassigned plan.
  select type, title, note
    into v_type, v_title, v_note
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

  insert into public.plans (coach_id, client_id, type, title, status, source_plan_id, note)
  values (auth.uid(), p_client, v_type, v_title, 'draft', p_template, v_note)
  returning id into v_new;

  if v_type = 'training' then
    for r_week in
      select id, position, name, note from public.plan_weeks where plan_id = p_template
    loop
      insert into public.plan_weeks (plan_id, position, name, note)
      values (v_new, r_week.position, r_week.name, r_week.note)
      returning id into v_new_week;

      for r_day in
        select id, position, name, note from public.plan_days where week_id = r_week.id
      loop
        insert into public.plan_days (plan_id, week_id, position, name, note)
        values (v_new, v_new_week, r_day.position, r_day.name, r_day.note)
        returning id into v_new_day;

        insert into public.plan_exercises
          (day_id, exercise_id, exercise_name, block, position, sets, reps, rest_seconds, tempo, note, progression)
        select v_new_day, e.exercise_id, e.exercise_name, e.block, e.position, e.sets, e.reps,
               e.rest_seconds, e.tempo, e.note, e.progression
        from public.plan_exercises e where e.day_id = r_day.id;
      end loop;
    end loop;
  else
    for r_meal in
      select id, position, name, note from public.plan_meals where plan_id = p_template
    loop
      insert into public.plan_meals (plan_id, position, name, note)
      values (v_new, r_meal.position, r_meal.name, r_meal.note)
      returning id into v_new_meal;

      insert into public.plan_meal_items
        (meal_id, food_id, food_name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, position, grams, note)
      select v_new_meal, mi.food_id, mi.food_name, mi.kcal_per_100g, mi.protein_g_per_100g,
             mi.carbs_g_per_100g, mi.fat_g_per_100g, mi.position, mi.grams, mi.note
      from public.plan_meal_items mi where mi.meal_id = r_meal.id;
    end loop;
  end if;

  return v_new;
end;
$$;
revoke all on function public.assign_plan_to_client(uuid, uuid) from public, anon;
grant execute on function public.assign_plan_to_client(uuid, uuid) to authenticated, service_role;
