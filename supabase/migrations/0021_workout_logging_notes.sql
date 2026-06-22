-- 0021_workout_logging_notes.sql
--
-- Phase 11 (workout-logging UX): let the set-logging screen capture the actual
-- work, surface PRs, and let the athlete deliver structured feedback to the coach.
--   1) athlete_profile.weight_unit — the athlete's preferred DISPLAY unit (kg/lb).
--      Load is ALWAYS stored as integer grams (money.md discipline); this only
--      changes how weight is shown / entered, never how it's stored.
--   2) v_exercise_prs — each athlete's best logged load per exercise, powering the
--      "New PR" badge. SECURITY INVOKER so base-table RLS applies (athlete sees
--      own, coach sees their clients').
--   3) workout_notes — athlete-authored, coach-readable feedback tied to a workout
--      (and optionally one exercise), categorised Challenge / Compliment. Stored so
--      we can build on it later (e.g. surface in chat). Client-owned shape
--      (foundations §1): owner + coach + admin read; the OWNER (an athlete) writes.
--
-- Idempotent so it can be re-pasted into the SQL editor.

-- ── Enums ─────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'weight_unit') then
    create type public.weight_unit as enum ('kg', 'lb');
  end if;
  if not exists (select 1 from pg_type where typname = 'note_category') then
    create type public.note_category as enum ('challenge', 'compliment');
  end if;
end
$$;

-- ── athlete_profile.weight_unit (additive; defaulted) ─────────────────────────
alter table public.athlete_profile
  add column if not exists weight_unit public.weight_unit not null default 'kg';

-- ── v_exercise_prs: best logged load per exercise, per athlete ─────────────────
-- SECURITY INVOKER (like v_session_adherence in 0016) so the QUERYING user's RLS
-- on the base tables applies — an athlete sees only their own PRs, a coach their
-- clients'. Views aren't base tables, so the "RLS enabled" invariant needn't (and
-- doesn't) cover them.
drop view if exists public.v_exercise_prs;
create view public.v_exercise_prs with (security_invoker = true) as
  select
    s.user_id,
    l.exercise_name,
    max(l.load_grams) as best_load_grams
  from public.exercise_set_logs l
  join public.workout_sessions s on s.id = l.session_id
  where l.load_grams is not null and l.load_grams > 0
  group by s.user_id, l.exercise_name;

grant select on public.v_exercise_prs to anon, authenticated;  -- anon: RLS -> 0 rows

-- ── workout_notes: athlete → coach structured feedback ────────────────────────
create table if not exists public.workout_notes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  -- The workout this is about (null = a general note not tied to one session).
  session_id       uuid references public.workout_sessions (id) on delete cascade,
  -- The specific exercise (null = about the whole workout). Snapshot the name so
  -- the note survives plan edits / off-plan movements (plan_exercises pattern).
  plan_exercise_id uuid references public.plan_exercises (id) on delete set null,
  exercise_name    text,
  category         public.note_category not null,
  body             text not null check (length(btrim(body)) between 1 and 2000),
  created_at       timestamptz not null default now(),  -- UTC (§11)
  updated_at       timestamptz not null default now()
);
create index if not exists workout_notes_user_idx on public.workout_notes (user_id, created_at desc);
create index if not exists workout_notes_session_idx on public.workout_notes (session_id);

alter table public.workout_notes enable row level security;

drop trigger if exists workout_notes_set_updated_at on public.workout_notes;
create trigger workout_notes_set_updated_at
  before update on public.workout_notes
  for each row execute function public.set_updated_at();

-- Server owns the author identity (never trust a client value): force
-- user_id = auth.uid() for client requests; passthrough for service_role / seed.
create or replace function public.handle_workout_note_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' or auth.uid() is null then
    return new;
  end if;
  new.user_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists workout_notes_handle_write on public.workout_notes;
create trigger workout_notes_handle_write
  before insert or update on public.workout_notes
  for each row execute function public.handle_workout_note_write();

-- Read: the owning athlete, their coach (is_coach_of), or an admin.
drop policy if exists workout_notes_select on public.workout_notes;
create policy workout_notes_select on public.workout_notes
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_of(user_id)
    or public.current_app_role() = 'admin'
  );

-- Write: the OWNER only, and only an athlete (these are athlete-authored; a coach
-- responds via chat, not here). The role check rejects coach/admin writes cleanly
-- rather than letting the identity trigger create a junk self-owned row.
drop policy if exists workout_notes_insert on public.workout_notes;
create policy workout_notes_insert on public.workout_notes
  for insert to authenticated
  with check (user_id = auth.uid() and public.current_app_role() = 'client');

drop policy if exists workout_notes_update on public.workout_notes;
create policy workout_notes_update on public.workout_notes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.current_app_role() = 'client');

drop policy if exists workout_notes_delete on public.workout_notes;
create policy workout_notes_delete on public.workout_notes
  for delete to authenticated
  using (user_id = auth.uid());

grant select on public.workout_notes to anon, authenticated;   -- anon: RLS -> 0 rows
grant insert, update, delete on public.workout_notes to authenticated;
