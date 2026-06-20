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

-- Phase 3 plans:
--   Coach A → Client A1: one PUBLISHED training plan + one DRAFT nutrition plan.
--   Coach B → Client B1: one PUBLISHED plan (cross-tenant control).
insert into public.plans (id, coach_id, client_id, type, title, status) values
  ('99990001-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'aaaa0001-0000-0000-0000-000000000001', 'training',  'A1 Strength Block', 'published'),
  ('99990002-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'aaaa0001-0000-0000-0000-000000000001', 'nutrition', 'A1 Cut (draft)',    'draft'),
  ('99990003-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222',
   'bbbb0001-0000-0000-0000-000000000001', 'training',  'B1 Plan',           'published');

insert into public.plan_items (plan_id, position, name) values
  ('99990001-0000-0000-0000-000000000001', 1, 'Squat 5x5'),
  ('99990001-0000-0000-0000-000000000001', 2, 'Bench 5x5'),
  ('99990002-0000-0000-0000-000000000002', 1, 'Breakfast'),
  ('99990003-0000-0000-0000-000000000003', 1, 'Deadlift 1x5');

alter table auth.users enable trigger on_auth_user_created;
