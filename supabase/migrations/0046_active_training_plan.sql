-- Active training plan preference (UX/IA refactor — multi-plan switching).
--
-- A client can be assigned several training plans. Until now the Home "today" ring
-- silently used whichever non-archived training plan happened to be newest, with no
-- way for the athlete to choose. This adds a client-owned pointer to the plan that
-- drives their Home ring.
--
-- Storage: a nullable column on athlete_profile (one row per client, already
-- owner-scoped). No new RLS needed — the existing athlete_profile_update policy is a
-- pure owner check (user_id = auth.uid()), and there is no coach-immutability trigger
-- on this table, so the client can set their own preference and only their own.
--
-- ON DELETE SET NULL: deleting a plan cleanly clears the pointer (so a dangling id
-- can never point the ring at a removed plan). The app additionally only ever honors
-- the pointer when it resolves to a plan the client actually has (defense in depth),
-- so even a stale/forged id degrades to "newest plan", never a cross-tenant read
-- (RLS on plans returns 0 rows for a plan that isn't theirs regardless).
alter table public.athlete_profile
  add column if not exists active_training_plan_id uuid
    references public.plans (id) on delete set null;
