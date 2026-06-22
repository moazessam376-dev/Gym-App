-- 0022_nutrition_system_templates.sql
--
-- Data seed (idempotent): ship ready-to-clone SYSTEM nutrition templates — global
-- plans (coach_id NULL, client_id NULL, published) every coach can browse under
-- "Start from a template" in new-plan and clone via clone_template (0014, which
-- deep-copies plan_meals + plan_meal_items). Mirrors the training templates in
-- 0015. Until now there were zero nutrition templates, so the picker looked empty.
--
-- Each meal item's macro SNAPSHOT is read straight from the GLOBAL food_library
-- (0010) so the numbers always match the canonical food — no hand-typed macros to
-- drift. Grams assume the library's "cooked" values where applicable. Fixed UUIDs
-- + an existence guard make re-applying a no-op.

-- ── Temp helper: insert one template meal item, macros pulled from food_library ──
create or replace function public._seed_tpl_meal_item(
  p_meal uuid, p_food uuid, p_pos int, p_grams int
) returns void language sql as $$
  insert into public.plan_meal_items
    (meal_id, food_id, food_name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, position, grams)
  select p_meal, f.id, f.name, f.kcal_per_100g, f.protein_g_per_100g, f.carbs_g_per_100g, f.fat_g_per_100g, p_pos, p_grams
  from public.food_library f where f.id = p_food;
$$;

-- ── 1) Lean Cut ──────────────────────────────────────────────────────────────
do $$
declare v_plan uuid := '7e510000-0000-0000-0000-000000000011'; m uuid;
begin
  if exists (select 1 from public.plans where id = v_plan) then return; end if;
  insert into public.plans (id, coach_id, client_id, type, title, status, note) values
    (v_plan, null, null, 'nutrition', 'Lean Cut', 'published',
     'High-protein fat-loss day (~1,800 kcal). Built around lean protein, fibrous veg and slow carbs to stay full in a deficit. Adjust portions to the client''s target.');

  insert into public.plan_meals (plan_id, position, name, note) values
    (v_plan, 0, 'Breakfast', 'High-protein start to blunt hunger through the morning.') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000006', 0, 60);  -- Rolled Oats
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000008', 1, 200); -- Egg White
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000d', 2, 100); -- Banana

  insert into public.plan_meals (plan_id, position, name) values (v_plan, 1, 'Lunch') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000001', 0, 200); -- Chicken Breast
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000004', 1, 150); -- White Rice
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000f', 2, 150); -- Broccoli

  insert into public.plan_meals (plan_id, position, name) values (v_plan, 2, 'Snack') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000009', 0, 200); -- Greek Yogurt
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000010', 1, 15);  -- Almonds

  insert into public.plan_meals (plan_id, position, name, note) values
    (v_plan, 3, 'Dinner', 'Lean protein + fibrous veg to finish satisfied on fewer calories.') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000003', 0, 150); -- Salmon
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000b', 1, 150); -- Sweet Potato
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000f', 2, 100); -- Broccoli
end
$$;

-- ── 2) Lean Bulk ─────────────────────────────────────────────────────────────
do $$
declare v_plan uuid := '7e510000-0000-0000-0000-000000000012'; m uuid;
begin
  if exists (select 1 from public.plans where id = v_plan) then return; end if;
  insert into public.plans (id, coach_id, client_id, type, title, status, note) values
    (v_plan, null, null, 'nutrition', 'Lean Bulk', 'published',
     'Calorie-surplus muscle-gain day (~2,800 kcal). Five feedings keep protein high and make the volume easier to eat. Scale carbs up or down to control the rate of gain.');

  insert into public.plan_meals (plan_id, position, name, note) values
    (v_plan, 0, 'Breakfast', 'Carbs + protein to fuel training later in the day.') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000006', 0, 100); -- Rolled Oats
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000007', 1, 150); -- Whole Egg
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000a', 2, 250); -- Whole Milk
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000d', 3, 120); -- Banana

  insert into public.plan_meals (plan_id, position, name) values (v_plan, 1, 'Lunch') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000002', 0, 200); -- Lean Beef Mince
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000004', 1, 250); -- White Rice
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000012', 2, 10);  -- Olive Oil

  insert into public.plan_meals (plan_id, position, name, note) values
    (v_plan, 2, 'Snack', 'Quick post-workout protein + easy calories.') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000014', 0, 30);  -- Whey Protein
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000011', 1, 30);  -- Peanut Butter
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000e', 2, 150); -- Apple

  insert into public.plan_meals (plan_id, position, name) values (v_plan, 3, 'Dinner') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000001', 0, 250); -- Chicken Breast
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000019', 1, 200); -- Pasta
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000f', 2, 150); -- Broccoli

  insert into public.plan_meals (plan_id, position, name, note) values
    (v_plan, 4, 'Pre-bed', 'Slow-digesting casein to feed muscle overnight.') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000016', 0, 200); -- Cottage Cheese
end
$$;

-- ── 3) Maintenance ───────────────────────────────────────────────────────────
do $$
declare v_plan uuid := '7e510000-0000-0000-0000-000000000013'; m uuid;
begin
  if exists (select 1 from public.plans where id = v_plan) then return; end if;
  insert into public.plans (id, coach_id, client_id, type, title, status, note) values
    (v_plan, null, null, 'nutrition', 'Maintenance', 'published',
     'Balanced maintenance / recomp day (~2,300 kcal). Even protein across four meals with a mix of whole-food carbs and healthy fats. A solid neutral starting point.');

  insert into public.plan_meals (plan_id, position, name) values (v_plan, 0, 'Breakfast') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000007', 0, 200); -- Whole Egg
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000001a', 1, 100); -- Whole Wheat Bread
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000013', 2, 60);  -- Avocado

  insert into public.plan_meals (plan_id, position, name) values (v_plan, 1, 'Lunch') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000001', 0, 220); -- Chicken Breast
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000005', 1, 250); -- Brown Rice
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000012', 2, 10);  -- Olive Oil

  insert into public.plan_meals (plan_id, position, name) values (v_plan, 2, 'Snack') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000009', 0, 250); -- Greek Yogurt
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000001e', 1, 20);  -- Honey
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000010', 2, 30);  -- Almonds

  insert into public.plan_meals (plan_id, position, name) values (v_plan, 3, 'Dinner') returning id into m;
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-000000000015', 0, 150); -- Tuna
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000c', 1, 300); -- Potato
  perform public._seed_tpl_meal_item(m, 'f0000000-0000-0000-0000-00000000000f', 2, 150); -- Broccoli
end
$$;

drop function public._seed_tpl_meal_item(uuid, uuid, int, int);
