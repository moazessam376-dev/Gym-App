-- seed.sql — deterministic fixtures for the RLS harness.
--
-- As of Phase 1, profiles are created by the on_auth_user_created trigger, so we
-- insert into auth.users (which auto-creates a 'client' profile) and then
-- promote/assign via UPDATE — the server-side path. This script runs as the
-- maintenance/superuser role, so RLS and the client-immutability guard allow it.
--
-- Tenants:
--   Coach A ── Client A1, Client A2
--   Coach B ── Client B1
--   Admin (sees all)

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'coach.a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'coach.b@example.test'),
  ('aaaa0001-0000-0000-0000-000000000001', 'client.a1@example.test'),
  ('aaaa0002-0000-0000-0000-000000000002', 'client.a2@example.test'),
  ('bbbb0001-0000-0000-0000-000000000001', 'client.b1@example.test'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin@example.test');

-- Promote roles, assign coaches, set names (the bootstrap trigger made them all
-- 'client' with no coach). Coaches/admin first so the coach_id FK resolves.
update public.profiles set role = 'coach', full_name = 'Coach A'
  where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set role = 'coach', full_name = 'Coach B'
  where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set role = 'admin', full_name = 'Admin'
  where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
update public.profiles set coach_id = '11111111-1111-1111-1111-111111111111', full_name = 'Client A1'
  where id = 'aaaa0001-0000-0000-0000-000000000001';
update public.profiles set coach_id = '11111111-1111-1111-1111-111111111111', full_name = 'Client A2'
  where id = 'aaaa0002-0000-0000-0000-000000000002';
update public.profiles set coach_id = '22222222-2222-2222-2222-222222222222', full_name = 'Client B1'
  where id = 'bbbb0001-0000-0000-0000-000000000001';

-- Progress: 2 rows for A1, 1 for A2 (both Coach A), 1 for B1 (Coach B).
insert into public.progress_entries (user_id, weight_grams, note) values
  ('aaaa0001-0000-0000-0000-000000000001', 80000, 'A1 first'),
  ('aaaa0001-0000-0000-0000-000000000001', 79500, 'A1 second'),
  ('aaaa0002-0000-0000-0000-000000000002', 70000, 'A2 first'),
  ('bbbb0001-0000-0000-0000-000000000001', 90000, 'B1 first');
