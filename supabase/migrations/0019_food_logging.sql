-- 0019_food_logging.sql
--
-- Phase 10: the athlete FOOD-LOGGING half of the daily loop (training logging is
-- already live in 0016). A CLIENT records what they ate (food_log_entries) and the
-- app rolls it up against a personalized daily target (nutrition_targets) seeded
-- from their Phase 9 profile or their coach's assigned nutrition plan.
--
-- Same deny-by-default tenancy as the rest of the app (foundations §1): a client
-- owns their own diary (user_id = auth.uid()); their coach can READ it (is_coach_of)
-- but not edit it (feedback goes via chat/coach notes). Targets are client-owned but
-- a coach MAY override them (the coaching path). All quantities are INTEGERS
-- (foundations §3): grams, kcal, macro grams — never floats. Food-log inserts are
-- rate-limited and the owner identity is server-set, reusing the messages (0012)
-- trigger shape. Idempotent so it can be re-pasted into the SQL editor.

-- ── Enums ─────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'meal_slot') then
    create type public.meal_slot as enum ('breakfast', 'lunch', 'dinner', 'snack');
  end if;
  if not exists (select 1 from pg_type where typname = 'target_source') then
    -- auto_estimated = TDEE estimate · self_set = athlete-typed ·
    -- coach_set = coach override · from_plan = computed from the assigned nutrition plan
    create type public.target_source as enum ('auto_estimated', 'self_set', 'coach_set', 'from_plan');
  end if;
end
$$;

-- ── nutrition_targets: one CURRENT daily target per athlete (client-owned) ─────
-- Auto-seeded from athlete_profile (TDEE) or from the assigned nutrition plan, and
-- editable by the athlete OR overridable by their coach. History/versioning is
-- deferred (one current row; the profile is the versioned cross-pillar contract).
create table if not exists public.nutrition_targets (
  user_id          uuid primary key references public.profiles (id) on delete cascade,
  kcal_target      integer not null check (kcal_target >= 0),
  protein_g_target integer not null check (protein_g_target >= 0),  -- grams
  carbs_g_target   integer not null check (carbs_g_target >= 0),    -- grams
  fat_g_target     integer not null check (fat_g_target >= 0),      -- grams
  source           public.target_source not null default 'self_set',
  set_by           uuid references public.profiles (id) on delete set null,  -- who last wrote it (server-set)
  created_at       timestamptz not null default now(),  -- UTC (§11)
  updated_at       timestamptz not null default now()
);

alter table public.nutrition_targets enable row level security;

drop trigger if exists nutrition_targets_set_updated_at on public.nutrition_targets;
create trigger nutrition_targets_set_updated_at
  before update on public.nutrition_targets
  for each row execute function public.set_updated_at();

-- Server owns `set_by` (= the writer) and keeps user_id immutable on update. The
-- client/coach still chooses WHICH athlete via user_id, gated by the policy below.
create or replace function public.handle_nutrition_target_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' or auth.uid() is null then
    return new;  -- trusted server / seed path
  end if;
  new.set_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;  -- the row key never moves
  end if;
  return new;
end;
$$;

drop trigger if exists nutrition_targets_handle_write on public.nutrition_targets;
create trigger nutrition_targets_handle_write
  before insert or update on public.nutrition_targets
  for each row execute function public.handle_nutrition_target_write();

-- Read: the owning client, their coach, or an admin.
drop policy if exists nutrition_targets_select on public.nutrition_targets;
create policy nutrition_targets_select on public.nutrition_targets
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_of(user_id)
    or public.current_app_role() = 'admin'
  );

-- Write: the athlete OR their coach (the override path). `with check` on the new
-- value means you can only target yourself or a client you actually coach.
drop policy if exists nutrition_targets_insert on public.nutrition_targets;
create policy nutrition_targets_insert on public.nutrition_targets
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_coach_of(user_id));

drop policy if exists nutrition_targets_update on public.nutrition_targets;
create policy nutrition_targets_update on public.nutrition_targets
  for update to authenticated
  using (user_id = auth.uid() or public.is_coach_of(user_id))
  with check (user_id = auth.uid() or public.is_coach_of(user_id));

-- Delete: owner only (rare).
drop policy if exists nutrition_targets_delete on public.nutrition_targets;
create policy nutrition_targets_delete on public.nutrition_targets
  for delete to authenticated
  using (user_id = auth.uid());

grant select on public.nutrition_targets to anon, authenticated;   -- anon: RLS -> 0 rows
grant insert, update, delete on public.nutrition_targets to authenticated;

-- ── food_log_entries: the diary (client-owned) ───────────────────────────────
create table if not exists public.food_log_entries (
  id                 uuid primary key default gen_random_uuid(),
  -- The owner (a client). This is the `user_id = auth.uid()` column from §1.
  user_id            uuid not null references public.profiles (id) on delete cascade,
  -- The calendar day this food counts toward; app passes the device-local date,
  -- default is the UTC date as a fallback (§11).
  log_date           date not null default (now() at time zone 'utc')::date,
  meal_slot          public.meal_slot not null,
  -- Library link (NULL = a one-off quick-add not in the library).
  food_id            uuid references public.food_library (id) on delete set null,
  -- Off-plan link (mirrors exercise_set_logs.plan_exercise_id): set = this entry
  -- fulfils a prescribed meal item; NULL = an off-plan extra. Informational for
  -- prescribed-vs-actual — the macro snapshot below is authoritative for totals.
  plan_meal_item_id  uuid references public.plan_meal_items (id) on delete set null,
  -- Display + macro SNAPSHOT (plan_meal_items pattern): renders and totals compute
  -- without re-reading food_library, and stay stable if the library is later edited.
  food_name          text not null,
  kcal_per_100g      integer not null default 0 check (kcal_per_100g >= 0),
  protein_g_per_100g integer not null default 0 check (protein_g_per_100g >= 0),
  carbs_g_per_100g   integer not null default 0 check (carbs_g_per_100g >= 0),
  fat_g_per_100g     integer not null default 0 check (fat_g_per_100g >= 0),
  grams              integer not null check (grams >= 0),  -- portion eaten, integer grams
  note               text,
  created_at         timestamptz not null default now(),   -- UTC (§11)
  updated_at         timestamptz not null default now()
);
create index if not exists food_log_entries_user_date_idx
  on public.food_log_entries (user_id, log_date);
create index if not exists food_log_entries_food_id_idx on public.food_log_entries (food_id);
create index if not exists food_log_entries_plan_meal_item_id_idx
  on public.food_log_entries (plan_meal_item_id);

alter table public.food_log_entries enable row level security;

drop trigger if exists food_log_entries_set_updated_at on public.food_log_entries;
create trigger food_log_entries_set_updated_at
  before update on public.food_log_entries
  for each row execute function public.set_updated_at();

-- Server sets the owner identity + rate-limits inserts (foundations §4, reusing the
-- messages 0012 shape). SECURITY INVOKER so the count runs under the inserter's RLS
-- (their own rows are always visible to them). Pinned search_path; schema-qualified.
create or replace function public.handle_food_log_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recent integer;
begin
  if current_user = 'service_role' then
    return new;  -- trusted server path
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser (RLS bypassed); not a client request
  end if;

  -- The server owns the owner identity (never trust a client value).
  new.user_id := auth.uid();

  -- Rate limit: at most 40 entries per rolling 10-second window per user.
  -- Generous for adding a multi-item meal in a burst; blocks runaway loops/spam.
  select count(*) into v_recent
    from public.food_log_entries
   where user_id = auth.uid()
     and created_at > now() - interval '10 seconds';
  if v_recent >= 40 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists food_log_entries_handle_insert on public.food_log_entries;
create trigger food_log_entries_handle_insert
  before insert on public.food_log_entries
  for each row execute function public.handle_food_log_insert();

-- Read: the owning client, their coach, or an admin (mirrors progress_entries).
drop policy if exists food_log_entries_select on public.food_log_entries;
create policy food_log_entries_select on public.food_log_entries
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_of(user_id)
    or public.current_app_role() = 'admin'
  );

-- Create / update / delete: the OWNER only. A coach reads the diary but does not
-- edit it (deliberately stricter than workout_sessions).
drop policy if exists food_log_entries_insert on public.food_log_entries;
create policy food_log_entries_insert on public.food_log_entries
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists food_log_entries_update on public.food_log_entries;
create policy food_log_entries_update on public.food_log_entries
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists food_log_entries_delete on public.food_log_entries;
create policy food_log_entries_delete on public.food_log_entries
  for delete to authenticated
  using (user_id = auth.uid());

grant select on public.food_log_entries to anon, authenticated;   -- anon: RLS -> 0 rows
grant insert, update, delete on public.food_log_entries to authenticated;

-- ── v_daily_nutrition: per-day macro roll-up (SECURITY INVOKER) ───────────────
-- Like v_session_adherence: security_invoker so the QUERYING user's base-table RLS
-- applies (athlete sees own days; coach sees their clients'). Sum-then-divide once
-- to minimise rounding; all outputs integer (§3). No cross-tenant aggregation here,
-- so no SECURITY DEFINER function is needed this phase.
drop view if exists public.v_daily_nutrition;
create view public.v_daily_nutrition with (security_invoker = true) as
  select
    e.user_id,
    e.log_date,
    round(sum(e.grams * e.kcal_per_100g)      / 100.0)::integer as kcal_total,
    round(sum(e.grams * e.protein_g_per_100g) / 100.0)::integer as protein_total,
    round(sum(e.grams * e.carbs_g_per_100g)   / 100.0)::integer as carbs_total,
    round(sum(e.grams * e.fat_g_per_100g)     / 100.0)::integer as fat_total,
    count(*)::integer                                           as entry_count
  from public.food_log_entries e
  group by e.user_id, e.log_date;

grant select on public.v_daily_nutrition to anon, authenticated;

-- ── nutrition_streak: consecutive days with ≥1 logged entry ───────────────────
-- Exact reuse of current_streak (0016): gaps-and-islands over distinct log_date.
-- SECURITY INVOKER — filters to p_user and relies on food_log_entries RLS, so a
-- coach calling it for their client is gated exactly like a direct read.
create or replace function public.nutrition_streak(p_user uuid default auth.uid())
returns integer
language sql
stable
set search_path = ''
as $$
  with d as (
    select distinct log_date as sd
    from public.food_log_entries
    where user_id = p_user
  ),
  grp as (
    select sd, (sd - (row_number() over (order by sd))::int) as g
    from d
  ),
  islands as (
    select max(sd) as end_sd, count(*)::int as len
    from grp
    group by g
  )
  select coalesce(
    (select len from islands
      where end_sd >= (now() at time zone 'utc')::date - 1
      order by len desc
      limit 1),
    0
  );
$$;

revoke all on function public.nutrition_streak(uuid) from public;
revoke execute on function public.nutrition_streak(uuid) from anon;
grant execute on function public.nutrition_streak(uuid) to authenticated, service_role;
