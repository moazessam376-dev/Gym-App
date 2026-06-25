-- seed.sql — deterministic fixtures for the RLS harness.
-- Applied by the harness as the maintenance/superuser role (bypasses RLS), so
-- the INSERT policies are not exercised here; they are tested explicitly later.
--
-- Tenants:
--   Coach A ── Client A1, Client A2
--   Coach B ── Client B1
--   Admin (sees all)
--   New User (auth.users row WITHOUT a profile — used to test the INSERT policy)

-- The 0003 signup trigger would auto-create a 'client' profile for every
-- auth.users row below, colliding with our explicit role assignments. Disable it
-- for seeding only — cases.test.ts exercises the trigger on its own.
alter table auth.users disable trigger on_auth_user_created;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'coach.a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'coach.b@example.test'),
  ('aaaa0001-0000-0000-0000-000000000001', 'client.a1@example.test'),
  ('aaaa0002-0000-0000-0000-000000000002', 'client.a2@example.test'),
  ('bbbb0001-0000-0000-0000-000000000001', 'client.b1@example.test'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin@example.test'),
  ('eeee0001-0000-0000-0000-000000000001', 'newuser@example.test');

-- Coaches/admin first so clients' coach_id FK resolves.
insert into public.profiles (id, role, coach_id, full_name) values
  ('11111111-1111-1111-1111-111111111111', 'coach',  null,                                   'Coach A'),
  ('22222222-2222-2222-2222-222222222222', 'coach',  null,                                   'Coach B'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin',  null,                                   'Admin'),
  ('aaaa0001-0000-0000-0000-000000000001', 'client', '11111111-1111-1111-1111-111111111111', 'Client A1'),
  ('aaaa0002-0000-0000-0000-000000000002', 'client', '11111111-1111-1111-1111-111111111111', 'Client A2'),
  ('bbbb0001-0000-0000-0000-000000000001', 'client', '22222222-2222-2222-2222-222222222222', 'Client B1');

-- Progress: 2 rows for A1, 1 for A2 (both Coach A), 1 for B1 (Coach B).
insert into public.progress_entries (user_id, weight_grams, note) values
  ('aaaa0001-0000-0000-0000-000000000001', 80000, 'A1 first'),
  ('aaaa0001-0000-0000-0000-000000000001', 79500, 'A1 second'),
  ('aaaa0002-0000-0000-0000-000000000002', 70000, 'A2 first'),
  ('bbbb0001-0000-0000-0000-000000000001', 90000, 'B1 first');

-- One invitation owned by Coach B — proves Coach A can't read another coach's.
insert into public.invitations (id, coach_id, email, token) values
  ('cccc0001-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222',
   'invitee.b@example.test',
   'cccc0002-0000-0000-0000-000000000002');

-- Phase 3 v2 (0010): plans are coach-owned TEMPLATES (client_id null) or assigned
-- copies. The exercise/food libraries' GLOBAL rows are seeded by the migration
-- itself; here we add a few deterministic rows for RLS tests.
--
-- Assigned plans (Coach A → Client A1, Coach B → Client B1):
insert into public.plans (id, coach_id, client_id, type, title, status) values
  ('99990001-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa0001-0000-0000-0000-000000000001', 'training',  'A1 Strength Block', 'published'),
  ('99990002-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa0001-0000-0000-0000-000000000001', 'nutrition', 'A1 Cut (draft)',    'draft'),
  ('99990004-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111',
   'aaaa0001-0000-0000-0000-000000000001', 'nutrition', 'A1 Meals',          'published'),
  ('99990003-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222',
   'bbbb0001-0000-0000-0000-000000000001', 'training',  'B1 Plan',           'published');

-- Coach A TEMPLATES (client_id null) — never visible to clients.
insert into public.plans (id, coach_id, client_id, type, title, status) values
  ('99990010-0000-0000-0000-000000000010',
   '11111111-1111-1111-1111-111111111111', null, 'training',  'PPL Template',  'draft'),
  ('99990011-0000-0000-0000-000000000011',
   '11111111-1111-1111-1111-111111111111', null, 'nutrition', 'Cut Template',  'draft');

-- Custom library entries: one per coach (proves cross-coach denial; globals are
-- seeded by the migration and readable by all).
insert into public.exercise_library (id, coach_id, name, muscle_group, primary_muscle) values
  ('e1000000-0000-0000-0000-00000000000a',
   '11111111-1111-1111-1111-111111111111', 'Coach A Special Press', 'push', 'chest');
insert into public.food_library
  (id, coach_id, name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g) values
  ('f1000000-0000-0000-0000-00000000000b',
   '22222222-2222-2222-2222-222222222222', 'Coach B Protein Bar', 350, 30, 40, 10);

-- Each training plan has a Week 1 (0014); days hang off the week (week_id NOT NULL).
insert into public.plan_weeks (id, plan_id, position, name) values
  ('ee000001-0000-0000-0000-000000000001', '99990001-0000-0000-0000-000000000001', 0, 'Week 1'),
  ('ee000003-0000-0000-0000-000000000003', '99990003-0000-0000-0000-000000000003', 0, 'Week 1'),
  ('ee000010-0000-0000-0000-000000000010', '99990010-0000-0000-0000-000000000010', 0, 'Week 1');

-- Training days + exercises (reference GLOBAL exercises seeded by the migration).
insert into public.plan_days (id, plan_id, week_id, position, name) values
  ('da000001-0000-0000-0000-000000000001', '99990001-0000-0000-0000-000000000001', 'ee000001-0000-0000-0000-000000000001', 1, 'Day 1 - Push'),
  ('da000003-0000-0000-0000-000000000003', '99990003-0000-0000-0000-000000000003', 'ee000003-0000-0000-0000-000000000003', 1, 'Day 1'),
  ('da000010-0000-0000-0000-000000000010', '99990010-0000-0000-0000-000000000010', 'ee000010-0000-0000-0000-000000000010', 1, 'Day 1 - Push');
insert into public.plan_exercises (day_id, exercise_id, exercise_name, block, position, sets, reps) values
  ('da000001-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', 'Barbell Bench Press', 'primary',   1, 4, '8-12'),
  ('da000001-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000006', 'Triceps Pushdown',    'accessory', 2, 3, '12-15'),
  ('da000003-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-00000000000a', 'Deadlift',            'primary',   1, 5, '5'),
  ('da000010-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-000000000001', 'Barbell Bench Press', 'primary',   1, 5, '5');

-- Nutrition meals + items (reference GLOBAL foods).
insert into public.plan_meals (id, plan_id, position, name) values
  ('dd000002-0000-0000-0000-000000000002', '99990002-0000-0000-0000-000000000002', 1, 'Breakfast'),
  ('dd000004-0000-0000-0000-000000000004', '99990004-0000-0000-0000-000000000004', 1, 'Breakfast'),
  ('dd000011-0000-0000-0000-000000000011', '99990011-0000-0000-0000-000000000011', 1, 'Breakfast');
insert into public.plan_meal_items
  (meal_id, food_id, food_name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, position, grams) values
  ('dd000002-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000007', 'Whole Egg',               155, 13,  1, 11, 1, 150),
  ('dd000004-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000007', 'Whole Egg',               155, 13,  1, 11, 1, 150),
  ('dd000011-0000-0000-0000-000000000011', 'f0000000-0000-0000-0000-000000000001', 'Chicken Breast (cooked)', 165, 31,  0,  4, 1, 200);

-- One pending coach application owned by Client A2 — proves an admin can read it
-- and Client A1 cannot.
insert into public.coach_applications (id, user_id, message) values
  ('0bbb0001-0000-0000-0000-000000000001',
   'aaaa0002-0000-0000-0000-000000000002',
   'A2 would like to coach');

-- Messages between Coach A and Client A1 (both directions) — proves the two
-- parties read them and outsiders (Coach B / Client B1) cannot. The insert
-- trigger leaves these untouched (seed runs with auth.uid() null).
insert into public.messages (id, sender_id, recipient_id, body) values
  ('ab000001-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'aaaa0001-0000-0000-0000-000000000001', 'Welcome aboard!'),
  ('ab000002-0000-0000-0000-000000000002',
   'aaaa0001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Thanks coach!'),
  -- A third Coach A → A1 message that A1 has reported (seed row below). Leaves
  -- ab000001 unreported so the report-INSERT positive control has a clean target.
  ('ab000003-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'aaaa0001-0000-0000-0000-000000000001', 'Heads up about something');

-- Chat replies (0037, Phase 18 Slice 2). A1 → Coach A replying to Coach A's ab000001.
update public.messages set reply_to_id = 'ab000001-0000-0000-0000-000000000001'
  where id = 'ab000002-0000-0000-0000-000000000002';

-- Chat safety (0034, Phase 18). Client A1 reported Coach A's message ab000003.
-- reporter/reported are set explicitly (the trigger only derives them when
-- auth.uid() is set; null in the seed). Proves: the reporter and an admin read it,
-- while the REPORTED user (Coach A) and an unrelated tenant (Coach B) cannot.
insert into public.message_reports
  (id, message_id, reporter_id, reported_user_id, reason, note, reported_body) values
  ('7e900001-0000-0000-0000-000000000001', 'ab000003-0000-0000-0000-000000000003',
   'aaaa0001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'harassment', 'Made me uncomfortable', 'Heads up about something');

-- Chat engagement (0036, Phase 18 Slice 2). Client A1 reacted 👍 to Coach A's
-- message ab000001. user_id is set explicitly (the trigger only derives it when
-- auth.uid() is set; null in the seed). Proves: both parties read the reaction,
-- outsiders cannot, and a reactor can remove their own.
insert into public.message_reactions (id, message_id, user_id, emoji) values
  ('4eac0001-0000-0000-0000-000000000001', 'ab000001-0000-0000-0000-000000000001',
   'aaaa0001-0000-0000-0000-000000000001', '👍');

-- One sanitized media row owned by Client A1 (a progress photo) — proves the owner
-- and their Coach A can read it, while Coach B / Client B1 cannot. Inserted by the
-- superuser seed (the table has no client-write policy; finalize writes it live).
insert into public.media (id, owner_id, kind, status, bucket, path, mime_type, size_bytes) values
  ('ed000001-0000-0000-0000-000000000001',
   'aaaa0001-0000-0000-0000-000000000001', 'progress_photo', 'ready',
   'media', 'aaaa0001-0000-0000-0000-000000000001/seed-photo.jpg', 'image/jpeg', 12345);

-- Voice note (0043, Phase 18). An `audio` media owned by COACH A, attached to a
-- message Coach A → Client A1 (empty body). Proves the participant read path: Client
-- A1 — neither the owner nor the owner's coach — can read the coach's media because
-- they are a party to a message referencing it; Coach B / Client B1 / Client A2 can't.
insert into public.media (id, owner_id, kind, status, bucket, path, mime_type, size_bytes) values
  ('ed000002-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'audio', 'ready',
   'media', '11111111-1111-1111-1111-111111111111/seed-voice.m4a', 'audio/mp4', 23456);

insert into public.messages (id, sender_id, recipient_id, body, media_id) values
  ('ab000004-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111', 'aaaa0001-0000-0000-0000-000000000001', '',
   'ed000002-0000-0000-0000-000000000002');

-- Completion logging (0016). Client A1 trained on 3 consecutive recent days
-- (→ a 3-day streak); Client A2 once this week; Client B1 (Coach B's client) once.
-- Proves cross-tenant denial + the leaderboard tenancy fence. Dates are relative
-- to current_date so the streak/leaderboard assertions stay deterministic.
insert into public.workout_sessions (id, user_id, plan_id, day_id, session_date, status, completed_at) values
  ('5e550001-0000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001',
   '99990001-0000-0000-0000-000000000001', 'da000001-0000-0000-0000-000000000001', current_date,     'completed', now()),
  ('5e550002-0000-0000-0000-000000000002', 'aaaa0001-0000-0000-0000-000000000001',
   '99990001-0000-0000-0000-000000000001', 'da000001-0000-0000-0000-000000000001', current_date - 1, 'completed', now()),
  ('5e550003-0000-0000-0000-000000000003', 'aaaa0001-0000-0000-0000-000000000001',
   '99990001-0000-0000-0000-000000000001', 'da000001-0000-0000-0000-000000000001', current_date - 2, 'completed', now()),
  ('5e550004-0000-0000-0000-000000000004', 'aaaa0002-0000-0000-0000-000000000002',
   null, null, current_date, 'completed', now()),
  ('5e550005-0000-0000-0000-000000000005', 'bbbb0001-0000-0000-0000-000000000001',
   '99990003-0000-0000-0000-000000000003', null, current_date, 'completed', now());

-- Three completed sets on A1's most recent session (planned day da000001 has 4+3 = 7
-- planned sets → adherence view sets_done = 3, sets_planned = 7).
insert into public.exercise_set_logs
  (id, session_id, plan_exercise_id, exercise_name, set_index, reps_done, load_grams, is_completed) values
  ('5e5e0001-0000-0000-0000-000000000001', '5e550001-0000-0000-0000-000000000001', null, 'Barbell Bench Press', 0, 8,  60000, true),
  ('5e5e0002-0000-0000-0000-000000000002', '5e550001-0000-0000-0000-000000000001', null, 'Barbell Bench Press', 1, 8,  60000, true),
  ('5e5e0003-0000-0000-0000-000000000003', '5e550001-0000-0000-0000-000000000001', null, 'Triceps Pushdown',    0, 12, 20000, true);

-- Profiles & goals (0017). Client A1 has an athlete_profile; Coach A has a
-- coach_profile. Proves: Coach A reads A1's goals, Coach B cannot; Client A1
-- reads Coach A's profile (their coach) but not Coach B's.
insert into public.athlete_profile (user_id, primary_goal, experience_level, height_cm, target_weight_grams, training_days, onboarded_at) values
  ('aaaa0001-0000-0000-0000-000000000001', 'build_muscle', 'intermediate', 178, 82000, 4, now());
insert into public.coach_profile (user_id, bio, specialties, years_experience, onboarded_at) values
  ('11111111-1111-1111-1111-111111111111', 'Strength & hypertrophy coach', '{hypertrophy,powerlifting}', 6, now());

-- Food logging (0019). Coach A set A1's daily target (the override path). Client A1
-- logged food today (one library food + one off-plan quick-add) and yesterday
-- (→ a 2-day nutrition streak); Client B1 (Coach B's client) logged once today.
-- Proves cross-tenant denial + the daily roll-up view + streak tenancy.
insert into public.nutrition_targets
  (user_id, kcal_target, protein_g_target, carbs_g_target, fat_g_target, source, set_by) values
  ('aaaa0001-0000-0000-0000-000000000001', 2400, 180, 250, 70, 'coach_set',
   '11111111-1111-1111-1111-111111111111');

insert into public.food_log_entries
  (id, user_id, log_date, meal_slot, food_id, plan_meal_item_id, food_name,
   kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, grams) values
  -- A1 today: a library food (Chicken Breast 200g) + an off-plan quick-add (null food_id).
  ('f10d0001-0000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001', current_date,
   'lunch',  'f0000000-0000-0000-0000-000000000001', null, 'Chicken Breast (cooked)', 165, 31, 0, 4, 200),
  ('f10d0002-0000-0000-0000-000000000002', 'aaaa0001-0000-0000-0000-000000000001', current_date,
   'snack',  null,                                   null, 'Banana',                   89,  1, 23, 0, 120),
  -- A1 yesterday (extends the streak to 2).
  ('f10d0003-0000-0000-0000-000000000003', 'aaaa0001-0000-0000-0000-000000000001', current_date - 1,
   'dinner', 'f0000000-0000-0000-0000-000000000004', null, 'White Rice (cooked)',     130,  3, 28, 0, 250),
  -- B1 (Coach B's client) today — must never be visible to Coach A / Client A1.
  ('f10d0004-0000-0000-0000-000000000004', 'bbbb0001-0000-0000-0000-000000000001', current_date,
   'lunch',  'f0000000-0000-0000-0000-000000000001', null, 'Chicken Breast (cooked)', 165, 31, 0, 4, 150);

-- Food preferences (0020). Client A1 (Coach A) likes Banana, avoids Almonds.
-- Client B1 (Coach B) likes Chicken. Proves Coach A reads A1's prefs while Coach B
-- cannot, and the cross-tenant denial. Uses the global food_library ids from 0010.
insert into public.food_preferences (user_id, food_id, kind) values
  ('aaaa0001-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-00000000000d', 'like'),  -- A1 ♥ Banana
  ('aaaa0001-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000010', 'avoid'), -- A1 ⊘ Almonds
  ('bbbb0001-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'like');  -- B1 ♥ Chicken

-- Workout notes (0021). Client A1 left feedback on their logged session — one
-- Challenge tied to an exercise, one Compliment about the whole workout. Client B1
-- (Coach B's client) left one. Proves Coach A reads A1's notes while Coach B
-- cannot, plus the cross-tenant denial. (v_exercise_prs is fed by the set logs
-- seeded above: A1's best Bench = 60000g, Triceps = 20000g.)
insert into public.workout_notes (id, user_id, session_id, plan_exercise_id, exercise_name, category, body) values
  ('40e00001-0000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001',
   '5e550001-0000-0000-0000-000000000001', null, 'Barbell Bench Press', 'challenge', 'Left shoulder felt tight on the top set'),
  ('40e00002-0000-0000-0000-000000000002', 'aaaa0001-0000-0000-0000-000000000001',
   '5e550001-0000-0000-0000-000000000001', null, null,                  'compliment', 'Loved this session, felt strong'),
  ('40e00003-0000-0000-0000-000000000003', 'bbbb0001-0000-0000-0000-000000000001',
   '5e550005-0000-0000-0000-000000000005', null, null,                  'challenge', 'Lower back fatigued on deadlifts');

-- Exercise unit prefs (0025). A1's gym bench is calibrated in lb. Proves Coach A
-- reads A1's per-exercise unit while Coach B cannot.
insert into public.exercise_unit_prefs (user_id, exercise_name, unit) values
  ('aaaa0001-0000-0000-0000-000000000001', 'Barbell Bench Press', 'lb');

-- Body metrics (0026). Coach-entered, VERIFIED InBody readings. Client A1 (Coach A)
-- has two scans (a baseline + a later one → a trend on Coach A's board); Client B1
-- (Coach B) has one. Proves Coach A reads A1's metrics while Coach B cannot, the
-- cross-tenant denial, and that the per-coach board is fenced. Seeded as superuser:
-- the verification trigger stamps verified_at for coach_entered rows.
insert into public.body_metrics
  (id, user_id, measured_at, weight_grams, body_fat_bp, skeletal_muscle_mass_grams, source) values
  ('b0d70001-0000-0000-0000-000000000001', 'aaaa0001-0000-0000-0000-000000000001',
   now() - interval '60 days', 92500, 2560, 39200, 'coach_entered'),
  ('b0d70002-0000-0000-0000-000000000002', 'aaaa0001-0000-0000-0000-000000000001',
   now() - interval '5 days',  90000, 2300, 39800, 'coach_entered'),
  ('b0d70003-0000-0000-0000-000000000003', 'bbbb0001-0000-0000-0000-000000000001',
   now() - interval '3 days',  50100, 2030, 21800, 'coach_entered');

-- AI usage ledger (0027, Phase 12b). One InBody-OCR attempt by Client A1. Proves the
-- owner reads their own usage while their coach (and any other user) cannot — a coach has
-- no business reading a client's AI counters, so this policy (unlike body_metrics) has no
-- is_coach_of branch.
insert into public.ai_usage_events (user_id, kind, provider) values
  ('aaaa0001-0000-0000-0000-000000000001', 'inbody_ocr', 'groq');

-- An UNVERIFIED OCR reading (0026 + Phase 12b) staged for Client A2 (Coach A's other
-- client, with no other metrics). source='inbody_ocr' → the verification trigger forces
-- verified_*=null. Proves the coach-confirm UPDATE stamps verification and that the
-- athlete cannot self-confirm. Distinct id; A2 has no verified rows so it stays off the
-- board until the confirm test runs.
insert into public.body_metrics
  (id, user_id, measured_at, weight_grams, body_fat_bp, skeletal_muscle_mass_grams, source) values
  ('b0d70004-0000-0000-0000-000000000004', 'aaaa0002-0000-0000-0000-000000000002',
   now() - interval '2 days', 81000, 1850, 35000, 'inbody_ocr');

-- Coach-only AI insight on Client A2's OCR reading (0028). Proves the coach reads it
-- while the athlete (the owner) cannot — the analysis is the coach's private
-- decision-support, not client-facing.
insert into public.body_metric_insights (metric_id, analysis, provider, created_by) values
  ('b0d70004-0000-0000-0000-000000000004',
   'Down 1.2% body fat vs baseline; trending toward the fat-loss goal.', 'groq',
   '11111111-1111-1111-1111-111111111111');

-- A coach comment on Client A2's reading (0028). Proves the owner + their coach read it,
-- the athlete cannot author one, and another coach cannot read it. author_id is given
-- explicitly (the trigger only overrides it when auth.uid() is set; null in seed).
insert into public.body_metric_comments (id, metric_id, author_id, body) values
  ('c0de0001-0000-0000-0000-000000000001', 'b0d70004-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111', 'Great progress — keep protein high this week.');

-- Coach-only AI plan nudge (0029, Phase 13) for Client A1. Like body_metric_insights,
-- proves the client's COACH reads it while the client (owner) cannot — the AI
-- plan-adjustment suggestions are the coach's private decision-support, never shown to
-- the athlete (its RLS has no owner branch). Service-role write only.
insert into public.plan_insights (client_id, analysis, provider, created_by) values
  ('aaaa0001-0000-0000-0000-000000000001',
   'Adherence strong; nudge protein +20g and add a 4th session.', 'groq',
   '11111111-1111-1111-1111-111111111111');

-- Coach analytics (0031, Phase 15). Coach A's AI roster summary — COACH-ONLY, but
-- unlike plan_insights the OWNER here is the coach, so the policy keeps an owner branch:
-- proves Coach A reads their OWN summary while Coach B (cross-tenant) and Client A1
-- cannot. Service-role write only. Also flag A1's published training plan as
-- AI-generated so coach_plan_effectiveness's ai_generated passthrough is exercised.
insert into public.coach_analytics_insights (coach_id, analysis, provider, model) values
  ('11111111-1111-1111-1111-111111111111',
   'Roster averaging strong adherence; 2 clients trending toward goal.', 'groq', 'llama-4-scout');

update public.plans set ai_generated = true
  where id = '99990001-0000-0000-0000-000000000001';

-- Public/private profiles (0044, Phase 19). A dedicated PRIVATE coach (Coach P, no
-- clients) lets us prove the is_public gate + the list-exclusion without colliding
-- with Coach B's coach_profile INSERT positive-control test.
insert into auth.users (id, email) values
  ('c0c0c0c0-0000-0000-0000-000000000001', 'coach.p@example.test');
insert into public.profiles (id, role, coach_id, full_name) values
  ('c0c0c0c0-0000-0000-0000-000000000001', 'coach', null, 'Coach P');

-- Coach A goes PUBLIC (portfolio); Coach P stays PRIVATE. Client A1's athlete profile
-- goes PUBLIC; Client B1 gets a PRIVATE athlete profile (B1 never self-inserts one, so
-- seeding it is safe — only the cross-owner forge attempt targets B1, and that still
-- fails the WITH CHECK). These exercise both the RPC allowlists and the avatar branch.
update public.coach_profile
  set is_public = true,
      achievements = '{"Coached 3 national-level lifters","NASM-CPT"}'
  where user_id = '11111111-1111-1111-1111-111111111111';

insert into public.coach_profile (user_id, bio, specialties, years_experience, is_public, onboarded_at) values
  ('c0c0c0c0-0000-0000-0000-000000000001', 'Private coach', '{conditioning}', 4, false, now());

update public.athlete_profile
  set is_public = true,
      public_achievements = '{"Down 5kg in 12 weeks","First powerlifting meet"}'
  where user_id = 'aaaa0001-0000-0000-0000-000000000001';

insert into public.athlete_profile (user_id, primary_goal, is_public) values
  ('bbbb0001-0000-0000-0000-000000000001', 'lose_fat', false);

-- Avatars (`avatar` media kind). Public owners' avatars (Coach A, Client A1) are
-- readable by ANY authenticated user via media's avatar branch; the private owner's
-- (Coach P) stays owner/admin-only. Insert the media before pointing avatar_media_id
-- at it (the ownership trigger verifies it belongs to the profile as an avatar).
insert into public.media (id, owner_id, kind, status, bucket, path, mime_type, size_bytes) values
  ('a0a70001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'avatar', 'ready',
   'media', '11111111-1111-1111-1111-111111111111/avatar.jpg', 'image/jpeg', 4096),
  ('a0a70002-0000-0000-0000-000000000002', 'aaaa0001-0000-0000-0000-000000000001', 'avatar', 'ready',
   'media', 'aaaa0001-0000-0000-0000-000000000001/avatar.jpg', 'image/jpeg', 4096),
  ('a0a70003-0000-0000-0000-000000000003', 'c0c0c0c0-0000-0000-0000-000000000001', 'avatar', 'ready',
   'media', 'c0c0c0c0-0000-0000-0000-000000000001/avatar.jpg', 'image/jpeg', 4096);

update public.profiles set avatar_media_id = 'a0a70001-0000-0000-0000-000000000001'
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set avatar_media_id = 'a0a70002-0000-0000-0000-000000000002'
  where id = 'aaaa0001-0000-0000-0000-000000000001';
update public.profiles set avatar_media_id = 'a0a70003-0000-0000-0000-000000000003'
  where id = 'c0c0c0c0-0000-0000-0000-000000000001';

alter table auth.users enable trigger on_auth_user_created;
