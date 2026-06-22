-- 0020_food_categories_preferences.sql
--
-- Phase 10.5: make the coach's nutrition plan-building faster & more personalized.
--   1) food_library.category — group/filter foods (Protein / Carbs / Fats / ...).
--   2) food_preferences — each ATHLETE marks foods they LIKE or want to AVOID.
--      Their coach can READ these (foundations §1 client-owned shape) so the food
--      picker can surface "Taha & Adam like bananas" and warn on avoided foods.
--
-- Athlete-owned writes only (coach is read-only on preferences, per product
-- decision). No cross-tenant aggregation function needed: a coach's plain SELECT on
-- food_preferences already returns exactly their own clients' rows via is_coach_of.
-- Idempotent so it can be re-pasted into the SQL editor.

-- ── Enums ─────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'food_category') then
    create type public.food_category as enum
      ('protein', 'carbs', 'fats', 'vegetables', 'fruit', 'dairy', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'food_pref_kind') then
    create type public.food_pref_kind as enum ('like', 'avoid');
  end if;
end
$$;

-- ── food_library.category (additive; nullable) ───────────────────────────────
alter table public.food_library
  add column if not exists category public.food_category;

create index if not exists food_library_category_idx on public.food_library (category);

-- Backfill the seeded global foods (0010). Only touch rows still uncategorised so
-- a coach's later recategorisation isn't clobbered on a re-run.
update public.food_library set category = 'protein' where category is null and id in (
  'f0000000-0000-0000-0000-000000000001', -- Chicken Breast
  'f0000000-0000-0000-0000-000000000002', -- Lean Beef Mince
  'f0000000-0000-0000-0000-000000000003', -- Salmon
  'f0000000-0000-0000-0000-000000000007', -- Whole Egg
  'f0000000-0000-0000-0000-000000000008', -- Egg White
  'f0000000-0000-0000-0000-000000000014', -- Whey Protein
  'f0000000-0000-0000-0000-000000000015', -- Tuna
  'f0000000-0000-0000-0000-00000000001b', -- Tofu
  'f0000000-0000-0000-0000-00000000001c'  -- Shrimp
);
update public.food_library set category = 'carbs' where category is null and id in (
  'f0000000-0000-0000-0000-000000000004', -- White Rice
  'f0000000-0000-0000-0000-000000000005', -- Brown Rice
  'f0000000-0000-0000-0000-000000000006', -- Rolled Oats
  'f0000000-0000-0000-0000-00000000000b', -- Sweet Potato
  'f0000000-0000-0000-0000-00000000000c', -- Potato
  'f0000000-0000-0000-0000-000000000017', -- Lentils
  'f0000000-0000-0000-0000-000000000018', -- Chickpeas
  'f0000000-0000-0000-0000-000000000019', -- Pasta
  'f0000000-0000-0000-0000-00000000001a', -- Whole Wheat Bread
  'f0000000-0000-0000-0000-00000000001d', -- Quinoa
  'f0000000-0000-0000-0000-00000000001e'  -- Honey
);
update public.food_library set category = 'fats' where category is null and id in (
  'f0000000-0000-0000-0000-000000000010', -- Almonds
  'f0000000-0000-0000-0000-000000000011', -- Peanut Butter
  'f0000000-0000-0000-0000-000000000012', -- Olive Oil
  'f0000000-0000-0000-0000-000000000013'  -- Avocado
);
update public.food_library set category = 'vegetables' where category is null and id in (
  'f0000000-0000-0000-0000-00000000000f'  -- Broccoli
);
update public.food_library set category = 'fruit' where category is null and id in (
  'f0000000-0000-0000-0000-00000000000d', -- Banana
  'f0000000-0000-0000-0000-00000000000e'  -- Apple
);
update public.food_library set category = 'dairy' where category is null and id in (
  'f0000000-0000-0000-0000-000000000009', -- Greek Yogurt
  'f0000000-0000-0000-0000-00000000000a', -- Whole Milk
  'f0000000-0000-0000-0000-000000000016'  -- Cottage Cheese
);

-- ── food_preferences: athlete-owned likes / avoids ───────────────────────────
create table if not exists public.food_preferences (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  food_id    uuid not null references public.food_library (id) on delete cascade,
  kind       public.food_pref_kind not null,
  created_at timestamptz not null default now(),  -- UTC (§11)
  updated_at timestamptz not null default now(),
  primary key (user_id, food_id)  -- one stance per food per athlete (toggling kind updates)
);
create index if not exists food_preferences_food_id_idx on public.food_preferences (food_id);

alter table public.food_preferences enable row level security;

drop trigger if exists food_preferences_set_updated_at on public.food_preferences;
create trigger food_preferences_set_updated_at
  before update on public.food_preferences
  for each row execute function public.set_updated_at();

-- Server owns the owner identity (never trust a client value): force
-- user_id = auth.uid() for client requests; passthrough for service_role/seed.
create or replace function public.handle_food_preference_write()
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

drop trigger if exists food_preferences_handle_write on public.food_preferences;
create trigger food_preferences_handle_write
  before insert or update on public.food_preferences
  for each row execute function public.handle_food_preference_write();

-- Read: the owning athlete, their coach (is_coach_of), or an admin.
drop policy if exists food_preferences_select on public.food_preferences;
create policy food_preferences_select on public.food_preferences
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_of(user_id)
    or public.current_app_role() = 'admin'
  );

-- Write: the OWNER only, and only an athlete (a coach/admin is read-only here, so
-- the role check rejects their writes cleanly rather than letting the identity
-- trigger create a junk self-owned row).
drop policy if exists food_preferences_insert on public.food_preferences;
create policy food_preferences_insert on public.food_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.current_app_role() = 'client');

drop policy if exists food_preferences_update on public.food_preferences;
create policy food_preferences_update on public.food_preferences
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.current_app_role() = 'client');

drop policy if exists food_preferences_delete on public.food_preferences;
create policy food_preferences_delete on public.food_preferences
  for delete to authenticated
  using (user_id = auth.uid());

grant select on public.food_preferences to anon, authenticated;   -- anon: RLS -> 0 rows
grant insert, update, delete on public.food_preferences to authenticated;
