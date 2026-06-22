-- 0025_exercise_unit_prefs.sql
--
-- Per-exercise weight-unit preference. Some machines are calibrated in lb, others
-- in kg, so the kg/lb choice belongs to the EXERCISE, not the whole workout. This
-- stores the athlete's chosen DISPLAY unit per movement (keyed by exercise_name,
-- consistent with v_exercise_prs); load is still always stored as integer grams.
-- athlete_profile.weight_unit (0021) remains the DEFAULT for movements with no
-- explicit choice. Client-owned (foundations §1); idempotent.

create table if not exists public.exercise_unit_prefs (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  exercise_name text not null,
  unit          public.weight_unit not null,
  updated_at    timestamptz not null default now(),  -- UTC (§11)
  primary key (user_id, exercise_name)
);

alter table public.exercise_unit_prefs enable row level security;

drop trigger if exists exercise_unit_prefs_set_updated_at on public.exercise_unit_prefs;
create trigger exercise_unit_prefs_set_updated_at
  before update on public.exercise_unit_prefs
  for each row execute function public.set_updated_at();

-- Server owns the owner identity (never trust a client value).
create or replace function public.handle_exercise_unit_pref_write()
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

drop trigger if exists exercise_unit_prefs_handle_write on public.exercise_unit_prefs;
create trigger exercise_unit_prefs_handle_write
  before insert or update on public.exercise_unit_prefs
  for each row execute function public.handle_exercise_unit_pref_write();

-- Read: the owning athlete, their coach (is_coach_of), or an admin.
drop policy if exists exercise_unit_prefs_select on public.exercise_unit_prefs;
create policy exercise_unit_prefs_select on public.exercise_unit_prefs
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_of(user_id)
    or public.current_app_role() = 'admin'
  );

-- Write: the OWNER only, and only an athlete (a display preference is theirs).
drop policy if exists exercise_unit_prefs_insert on public.exercise_unit_prefs;
create policy exercise_unit_prefs_insert on public.exercise_unit_prefs
  for insert to authenticated
  with check (user_id = auth.uid() and public.current_app_role() = 'client');

drop policy if exists exercise_unit_prefs_update on public.exercise_unit_prefs;
create policy exercise_unit_prefs_update on public.exercise_unit_prefs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.current_app_role() = 'client');

drop policy if exists exercise_unit_prefs_delete on public.exercise_unit_prefs;
create policy exercise_unit_prefs_delete on public.exercise_unit_prefs
  for delete to authenticated
  using (user_id = auth.uid());

grant select on public.exercise_unit_prefs to anon, authenticated;   -- anon: RLS -> 0 rows
grant insert, update, delete on public.exercise_unit_prefs to authenticated;
