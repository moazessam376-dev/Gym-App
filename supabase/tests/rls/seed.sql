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
   'aaaa0001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Thanks coach!');

-- One sanitized media row owned by Client A1 (a progress photo) — proves the owner
-- and their Coach A can read it, while Coach B / Client B1 cannot. Inserted by the
-- superuser seed (the table has no client-write policy; finalize writes it live).
insert into public.media (id, owner_id, kind, status, bucket, path, mime_type, size_bytes) values
  ('ed000001-0000-0000-0000-000000000001',
   'aaaa0001-0000-0000-0000-000000000001', 'progress_photo', 'ready',
   'media', 'aaaa0001-0000-0000-0000-000000000001/seed-photo.jpg', 'image/jpeg', 12345);

alter table auth.users enable trigger on_auth_user_created;
