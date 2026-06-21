-- 0015_system_templates.sql
--
-- Data seed (idempotent): (1) expand the GLOBAL exercise library with the missing
-- movements coaches need, and (2) ship ready-to-clone SYSTEM TEMPLATES — global
-- training plans (coach_id NULL, client_id NULL) every coach can browse and clone
-- via clone_template (0014), each pre-filled with Week 1 → days → exercises and
-- example coach comments at plan / day / exercise level. Fixed UUIDs + guards make
-- re-applying a no-op.

-- ── New global exercises (coach_id NULL). Continue the e0000000 series ────────
insert into public.exercise_library (id, coach_id, name, muscle_group, primary_muscle) values
  ('e0000000-0000-0000-0000-000000000029', null, 'Dumbbell Bench Press', 'push',  'chest'),
  ('e0000000-0000-0000-0000-00000000002a', null, 'Pec Deck',             'push',  'chest'),
  ('e0000000-0000-0000-0000-00000000002b', null, 'Skullcrusher',         'push',  'triceps'),
  ('e0000000-0000-0000-0000-00000000002c', null, 'Dumbbell Row',         'pull',  'back'),
  ('e0000000-0000-0000-0000-00000000002d', null, 'Sumo Deadlift',        'legs',  'glutes'),
  ('e0000000-0000-0000-0000-00000000002e', null, 'Hack Squat',           'legs',  'quads'),
  ('e0000000-0000-0000-0000-00000000002f', null, 'Lying Leg Curl',       'legs',  'hamstrings'),
  ('e0000000-0000-0000-0000-000000000030', null, 'Cable Pull-through',   'legs',  'glutes'),
  ('e0000000-0000-0000-0000-000000000031', null, 'Seated Calf Raise',    'legs',  'calves')
on conflict (id) do nothing;

-- ── Temp helper: insert one template exercise row (runs as the seed superuser) ──
create or replace function public._seed_tpl_ex(
  p_day uuid, p_ex uuid, p_name text, p_block text, p_pos int, p_sets int, p_reps text, p_note text default null
) returns void language sql as $$
  insert into public.plan_exercises (day_id, exercise_id, exercise_name, block, position, sets, reps, note)
  values (p_day, p_ex, p_name, p_block::public.training_block, p_pos, p_sets, p_reps, p_note);
$$;

-- ── 1) 3-Day Full Body ───────────────────────────────────────────────────────
do $$
declare v_plan uuid := '7e510000-0000-0000-0000-000000000001'; v_week uuid; d uuid;
begin
  if exists (select 1 from public.plans where id = v_plan) then return; end if;
  insert into public.plans (id, coach_id, client_id, type, title, status, note) values
    (v_plan, null, null, 'training', '3-Day Full Body', 'published',
     'Beginner-friendly full body, 3×/week. Add weight when you complete all sets at the top of the rep range.');
  insert into public.plan_weeks (plan_id, position, name) values (v_plan, 0, 'Week 1') returning id into v_week;

  insert into public.plan_days (plan_id, week_id, position, name, note) values
    (v_plan, v_week, 0, 'Full Body A', 'Start with the compound lift while you are fresh.') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000013', 'Back Squat', 'primary', 0, 3, '5', 'Brace your core; squat to at least parallel.');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000001', 'Barbell Bench Press', 'primary', 1, 3, '5', 'Touch the chest, full lockout.');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000d', 'Barbell Row', 'primary', 2, 3, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000003', 'Overhead Press', 'accessory', 3, 3, '8-10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000024', 'Plank', 'accessory', 4, 3, '30-60s');

  insert into public.plan_days (plan_id, week_id, position, name) values
    (v_plan, v_week, 1, 'Full Body B') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000a', 'Deadlift', 'primary', 0, 3, '5', 'Reset each rep; keep a neutral spine.');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000002', 'Incline Dumbbell Press', 'primary', 1, 3, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000c', 'Lat Pulldown', 'primary', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000016', 'Leg Press', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000025', 'Hanging Leg Raise', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values
    (v_plan, v_week, 2, 'Full Body C') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000014', 'Front Squat', 'primary', 0, 3, '6');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000008', 'Dips', 'primary', 1, 3, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000e', 'Seated Cable Row', 'primary', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000009', 'Lateral Raise', 'accessory', 3, 3, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000010', 'Barbell Curl', 'accessory', 4, 3, '12');
end
$$;

-- ── 2) 4-Day Upper/Lower ─────────────────────────────────────────────────────
do $$
declare v_plan uuid := '7e510000-0000-0000-0000-000000000002'; v_week uuid; d uuid;
begin
  if exists (select 1 from public.plans where id = v_plan) then return; end if;
  insert into public.plans (id, coach_id, client_id, type, title, status, note) values
    (v_plan, null, null, 'training', '4-Day Upper/Lower', 'published',
     'Classic 4-day Upper/Lower split — two upper, two lower, ~48h between similar sessions. Add an Arm or weak-point day if you want.');
  insert into public.plan_weeks (plan_id, position, name) values (v_plan, 0, 'Week 1') returning id into v_week;

  insert into public.plan_days (plan_id, week_id, position, name, note) values
    (v_plan, v_week, 0, 'Upper A', 'Push-focused. Leave 2-3 reps in reserve on the first heavy sets.') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000001', 'Barbell Bench Press', 'primary', 0, 4, '6-8', 'Touch the chest, full lockout.');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000d', 'Barbell Row', 'primary', 1, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000003', 'Overhead Press', 'accessory', 2, 3, '8-10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000c', 'Lat Pulldown', 'accessory', 3, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000006', 'Triceps Pushdown', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values
    (v_plan, v_week, 1, 'Lower A') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000013', 'Back Squat', 'primary', 0, 4, '6-8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000015', 'Romanian Deadlift', 'primary', 1, 3, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000016', 'Leg Press', 'accessory', 2, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002f', 'Lying Leg Curl', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000001a', 'Standing Calf Raise', 'accessory', 4, 4, '15');

  insert into public.plan_days (plan_id, week_id, position, name) values
    (v_plan, v_week, 2, 'Upper B') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000b', 'Pull-up', 'primary', 0, 4, '6-8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000002', 'Incline Dumbbell Press', 'primary', 1, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000e', 'Seated Cable Row', 'accessory', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000009', 'Lateral Raise', 'accessory', 3, 4, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000010', 'Barbell Curl', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values
    (v_plan, v_week, 3, 'Lower B') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000a', 'Deadlift', 'primary', 0, 3, '5');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000014', 'Front Squat', 'primary', 1, 3, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000021', 'Bulgarian Split Squat', 'accessory', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000023', 'Seated Leg Curl', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000031', 'Seated Calf Raise', 'accessory', 4, 4, '15');
end
$$;

-- ── 3) 6-Day Push/Pull/Legs ──────────────────────────────────────────────────
do $$
declare v_plan uuid := '7e510000-0000-0000-0000-000000000003'; v_week uuid; d uuid;
begin
  if exists (select 1 from public.plans where id = v_plan) then return; end if;
  insert into public.plans (id, coach_id, client_id, type, title, status, note) values
    (v_plan, null, null, 'training', '6-Day Push/Pull/Legs', 'published',
     'High-frequency PPL run twice per week. Best for intermediates who can train 6 days. Drop to 3 days (P/P/L once) if recovery suffers.');
  insert into public.plan_weeks (plan_id, position, name) values (v_plan, 0, 'Week 1') returning id into v_week;

  insert into public.plan_days (plan_id, week_id, position, name, note) values
    (v_plan, v_week, 0, 'Push A', 'Chest & shoulder strength. Pick a weight you could do for ~10 but stop at 6-8.') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000001', 'Barbell Bench Press', 'primary', 0, 4, '6-8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000003', 'Overhead Press', 'primary', 1, 3, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000002', 'Incline Dumbbell Press', 'accessory', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000009', 'Lateral Raise', 'accessory', 3, 4, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000006', 'Triceps Pushdown', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 1, 'Pull A') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000a', 'Deadlift', 'primary', 0, 3, '5');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000b', 'Pull-up', 'primary', 1, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000d', 'Barbell Row', 'accessory', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000f', 'Face Pull', 'accessory', 3, 3, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000010', 'Barbell Curl', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 2, 'Legs A') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000013', 'Back Squat', 'primary', 0, 4, '6-8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000015', 'Romanian Deadlift', 'primary', 1, 3, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000016', 'Leg Press', 'accessory', 2, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002f', 'Lying Leg Curl', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000001a', 'Standing Calf Raise', 'accessory', 4, 4, '15');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 3, 'Push B') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000001f', 'Incline Barbell Press', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000004', 'Dumbbell Shoulder Press', 'primary', 1, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000005', 'Cable Fly', 'accessory', 2, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000009', 'Lateral Raise', 'accessory', 3, 4, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002b', 'Skullcrusher', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 4, 'Pull B') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000c', 'Lat Pulldown', 'primary', 0, 4, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000e', 'Seated Cable Row', 'primary', 1, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002c', 'Dumbbell Row', 'accessory', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000f', 'Face Pull', 'accessory', 3, 3, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000012', 'Hammer Curl', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 5, 'Legs B') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000014', 'Front Squat', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000001b', 'Hip Thrust', 'primary', 1, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000019', 'Walking Lunge', 'accessory', 2, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000023', 'Seated Leg Curl', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000031', 'Seated Calf Raise', 'accessory', 4, 4, '15');
end
$$;

-- ── 4) 5-Day Bro Split ───────────────────────────────────────────────────────
do $$
declare v_plan uuid := '7e510000-0000-0000-0000-000000000004'; v_week uuid; d uuid;
begin
  if exists (select 1 from public.plans where id = v_plan) then return; end if;
  insert into public.plans (id, coach_id, client_id, type, title, status, note) values
    (v_plan, null, null, 'training', '5-Day Bro Split', 'published',
     'One muscle group per day, high volume. A classic bodybuilding split for lifters who like to fully fry each muscle.');
  insert into public.plan_weeks (plan_id, position, name) values (v_plan, 0, 'Week 1') returning id into v_week;

  insert into public.plan_days (plan_id, week_id, position, name, note) values
    (v_plan, v_week, 0, 'Chest', 'Vary the angles — flat, incline, fly — to hit the whole chest.') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000001', 'Barbell Bench Press', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000002', 'Incline Dumbbell Press', 'primary', 1, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002a', 'Pec Deck', 'accessory', 2, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000005', 'Cable Fly', 'accessory', 3, 3, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000008', 'Dips', 'accessory', 4, 3, '10');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 1, 'Back') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000a', 'Deadlift', 'primary', 0, 3, '5');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000b', 'Pull-up', 'primary', 1, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000d', 'Barbell Row', 'primary', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000c', 'Lat Pulldown', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000e', 'Seated Cable Row', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 2, 'Shoulders') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000003', 'Overhead Press', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000004', 'Dumbbell Shoulder Press', 'primary', 1, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000009', 'Lateral Raise', 'accessory', 2, 4, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000f', 'Face Pull', 'accessory', 3, 3, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000001e', 'Arnold Press', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 3, 'Legs') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000013', 'Back Squat', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000016', 'Leg Press', 'primary', 1, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000015', 'Romanian Deadlift', 'accessory', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000018', 'Leg Extension', 'accessory', 3, 3, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000001a', 'Standing Calf Raise', 'accessory', 4, 4, '15');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 4, 'Arms') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000010', 'Barbell Curl', 'primary', 0, 4, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002b', 'Skullcrusher', 'primary', 1, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000012', 'Hammer Curl', 'accessory', 2, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000006', 'Triceps Pushdown', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000011', 'Dumbbell Curl', 'accessory', 4, 3, '15');
end
$$;

-- ── 5) Arnold Split (6-day) ──────────────────────────────────────────────────
do $$
declare v_plan uuid := '7e510000-0000-0000-0000-000000000005'; v_week uuid; d uuid;
begin
  if exists (select 1 from public.plans where id = v_plan) then return; end if;
  insert into public.plans (id, coach_id, client_id, type, title, status, note) values
    (v_plan, null, null, 'training', 'Arnold Split', 'published',
     'Arnold''s high-frequency split — Chest+Back, Shoulders+Arms, Legs — twice per week. Very high volume; only run it with solid recovery.');
  insert into public.plan_weeks (plan_id, position, name) values (v_plan, 0, 'Week 1') returning id into v_week;

  insert into public.plan_days (plan_id, week_id, position, name, note) values
    (v_plan, v_week, 0, 'Chest & Back A', 'Superset chest and back movements to save time and boost the pump.') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000001', 'Barbell Bench Press', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000d', 'Barbell Row', 'primary', 1, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000002', 'Incline Dumbbell Press', 'accessory', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000b', 'Pull-up', 'accessory', 3, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000005', 'Cable Fly', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 1, 'Shoulders & Arms A') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000003', 'Overhead Press', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000009', 'Lateral Raise', 'accessory', 1, 4, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000010', 'Barbell Curl', 'accessory', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002b', 'Skullcrusher', 'accessory', 3, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000012', 'Hammer Curl', 'accessory', 4, 3, '12');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 2, 'Legs A') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000013', 'Back Squat', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000015', 'Romanian Deadlift', 'primary', 1, 3, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000016', 'Leg Press', 'accessory', 2, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002f', 'Lying Leg Curl', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000001a', 'Standing Calf Raise', 'accessory', 4, 4, '15');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 3, 'Chest & Back B') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000001f', 'Incline Barbell Press', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000e', 'Seated Cable Row', 'primary', 1, 4, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000008', 'Dips', 'accessory', 2, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000c', 'Lat Pulldown', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002a', 'Pec Deck', 'accessory', 4, 3, '15');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 4, 'Shoulders & Arms B') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000004', 'Dumbbell Shoulder Press', 'primary', 0, 4, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000000f', 'Face Pull', 'accessory', 1, 3, '15');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000011', 'Dumbbell Curl', 'accessory', 2, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000006', 'Triceps Pushdown', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000009', 'Lateral Raise', 'accessory', 4, 4, '15');

  insert into public.plan_days (plan_id, week_id, position, name) values (v_plan, v_week, 5, 'Legs B') returning id into d;
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000014', 'Front Squat', 'primary', 0, 4, '8');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000001b', 'Hip Thrust', 'primary', 1, 3, '10');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-00000000002e', 'Hack Squat', 'accessory', 2, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000023', 'Seated Leg Curl', 'accessory', 3, 3, '12');
  perform public._seed_tpl_ex(d, 'e0000000-0000-0000-0000-000000000031', 'Seated Calf Raise', 'accessory', 4, 4, '15');
end
$$;

drop function public._seed_tpl_ex(uuid, uuid, text, text, int, int, text, text);
