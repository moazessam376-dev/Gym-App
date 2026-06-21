// Data layer for Phase 3 plans v2. A plan is a coach-owned TEMPLATE (client_id
// null) or an assigned copy. Reads go through RLS (coach: own templates + own
// assigned; client: own non-draft). Writes are Zod-validated; coach_id/version/
// source_plan_id are server-controlled. Assigning a template deep-copies it via
// the assign_plan_to_client RPC (the only path that sets client_id).
import { supabase } from './supabase';
import {
  createDaySchema,
  createExerciseRowSchema,
  createMealItemSchema,
  createMealSchema,
  createTemplateSchema,
  createWeekSchema,
  updateDaySchema,
  updateExerciseRowSchema,
  updateMealItemSchema,
  updateMealSchema,
  updatePlanSchema,
  updateWeekSchema,
  type CreateDay,
  type CreateExerciseRow,
  type CreateMeal,
  type CreateMealItem,
  type CreateTemplate,
  type CreateWeek,
  type PlanStatus,
  type PlanType,
  type TrainingBlock,
  type UpdateDay,
  type UpdateExerciseRow,
  type UpdateMeal,
  type UpdateMealItem,
  type UpdatePlan,
  type UpdateWeek,
} from '../schemas/plan';

export type Plan = {
  id: string;
  coach_id: string | null; // null = global SYSTEM template
  client_id: string | null; // null = template (coach-owned or system)
  type: PlanType;
  title: string;
  status: PlanStatus;
  version: number;
  source_plan_id: string | null;
  note: string | null; // plan-level coach comment
  created_at: string;
  updated_at: string;
};

export type Week = {
  id: string;
  plan_id: string;
  position: number;
  name: string;
  note: string | null;
};

export type Day = {
  id: string;
  plan_id: string;
  week_id: string;
  position: number;
  name: string;
  note: string | null; // day-level coach comment
};

export type ExerciseRow = {
  id: string;
  day_id: string;
  exercise_id: string;
  exercise_name: string;
  block: TrainingBlock;
  position: number;
  sets: number | null;
  reps: string | null;
  rest_seconds: number | null;
  tempo: string | null;
  note: string | null;
};

export type Meal = { id: string; plan_id: string; position: number; name: string; note: string | null };

export type MealItem = {
  id: string;
  meal_id: string;
  food_id: string;
  food_name: string;
  kcal_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
  position: number;
  grams: number;
  note: string | null;
};

const PLAN_COLS =
  'id, coach_id, client_id, type, title, status, version, source_plan_id, note, created_at, updated_at';
const WEEK_COLS = 'id, plan_id, position, name, note';
const DAY_COLS = 'id, plan_id, week_id, position, name, note';
const EX_COLS =
  'id, day_id, exercise_id, exercise_name, block, position, sets, reps, rest_seconds, tempo, note';
const MEAL_COLS = 'id, plan_id, position, name, note';
const MEAL_ITEM_COLS =
  'id, meal_id, food_id, food_name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, position, grams, note';

// ── Plans / templates ────────────────────────────────────────────────────────

/** The coach's OWN templates (client_id IS NULL, coach-owned), optional type. */
export async function listTemplates(type?: PlanType): Promise<Plan[]> {
  let q = supabase
    .from('plans')
    .select(PLAN_COLS)
    .is('client_id', null)
    .not('coach_id', 'is', null) // exclude global system templates
    .order('created_at', { ascending: false });
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Plan[];
}

/** Global SYSTEM templates (coach_id IS NULL) — ready to clone. RLS: coaches only. */
export async function listSystemTemplates(type?: PlanType): Promise<Plan[]> {
  let q = supabase
    .from('plans')
    .select(PLAN_COLS)
    .is('client_id', null)
    .is('coach_id', null)
    .order('title', { ascending: true });
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Plan[];
}

/**
 * Clone a template (the coach's own OR a global system one) into a NEW editable
 * coach-owned template. The RPC (clone_template) is the only path; it deep-copies
 * weeks→days→exercises (+ comments). Returns the new plan id.
 */
export async function cloneTemplate(templateId: string): Promise<string> {
  const { data, error } = await supabase.rpc('clone_template', { p_template: templateId });
  if (error) throw error;
  return data as string;
}

/** Plans assigned to one client (RLS: coach sees all, client sees own non-draft). */
export async function listPlansForClient(clientId: string): Promise<Plan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select(PLAN_COLS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Plan[];
}

export async function getPlan(planId: string): Promise<Plan | null> {
  const { data, error } = await supabase.from('plans').select(PLAN_COLS).eq('id', planId).maybeSingle();
  if (error) throw error;
  return (data as Plan) ?? null;
}

/** Create a coach-owned template (no client). */
export async function createTemplate(coachId: string, input: CreateTemplate): Promise<Plan> {
  const v = createTemplateSchema.parse(input);
  const { data, error } = await supabase
    .from('plans')
    .insert({ coach_id: coachId, client_id: null, type: v.type, title: v.title })
    .select(PLAN_COLS)
    .single();
  if (error) throw error;
  return data as Plan;
}

export async function updatePlan(planId: string, input: UpdatePlan): Promise<void> {
  const v = updatePlanSchema.parse(input);
  const { error } = await supabase.from('plans').update(v).eq('id', planId);
  if (error) throw error;
}

export async function setPlanStatus(planId: string, status: PlanStatus): Promise<void> {
  return updatePlan(planId, { status });
}

export async function deletePlan(planId: string): Promise<void> {
  const { error } = await supabase.from('plans').delete().eq('id', planId);
  if (error) throw error;
}

/**
 * Assign a template to a client — deep-copies the template into a new draft plan
 * owned by the coach and assigned to the client. The RPC (assign_plan_to_client)
 * is the only writer of client_id on a copied plan; it enforces that the template
 * is the caller's and the target is their client. Returns the new plan id.
 */
export async function assignPlanToClient(templateId: string, clientId: string): Promise<string> {
  const { data, error } = await supabase.rpc('assign_plan_to_client', {
    p_template: templateId,
    p_client: clientId,
  });
  if (error) throw error;
  return data as string;
}

// ── Training: weeks → days → exercises ───────────────────────────────────────

export async function listWeeks(planId: string): Promise<Week[]> {
  const { data, error } = await supabase
    .from('plan_weeks')
    .select(WEEK_COLS)
    .eq('plan_id', planId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Week[];
}

export async function createWeek(input: CreateWeek): Promise<Week> {
  const v = createWeekSchema.parse(input);
  const { data, error } = await supabase
    .from('plan_weeks')
    .insert({ plan_id: v.plan_id, name: v.name, note: v.note ?? null, position: v.position ?? 0 })
    .select(WEEK_COLS)
    .single();
  if (error) throw error;
  return data as Week;
}

export async function updateWeek(weekId: string, input: UpdateWeek): Promise<void> {
  const v = updateWeekSchema.parse(input);
  const { error } = await supabase.from('plan_weeks').update(v).eq('id', weekId);
  if (error) throw error;
}

export async function deleteWeek(weekId: string): Promise<void> {
  const { error } = await supabase.from('plan_weeks').delete().eq('id', weekId);
  if (error) throw error;
}

/** Duplicate a week (+ its days/exercises) into a new week in the same plan. */
export async function duplicateWeek(weekId: string): Promise<string> {
  const { data, error } = await supabase.rpc('duplicate_plan_week', { p_week: weekId });
  if (error) throw error;
  return data as string;
}

export async function listDays(weekId: string): Promise<Day[]> {
  const { data, error } = await supabase
    .from('plan_days')
    .select(DAY_COLS)
    .eq('week_id', weekId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Day[];
}

export async function createDay(input: CreateDay): Promise<Day> {
  const v = createDaySchema.parse(input);
  const { data, error } = await supabase
    .from('plan_days')
    .insert({ plan_id: v.plan_id, week_id: v.week_id, name: v.name, position: v.position ?? 0 })
    .select(DAY_COLS)
    .single();
  if (error) throw error;
  return data as Day;
}

export async function updateDay(dayId: string, input: UpdateDay): Promise<void> {
  const v = updateDaySchema.parse(input);
  const { error } = await supabase.from('plan_days').update(v).eq('id', dayId);
  if (error) throw error;
}

export async function deleteDay(dayId: string): Promise<void> {
  const { error } = await supabase.from('plan_days').delete().eq('id', dayId);
  if (error) throw error;
}

export async function listExerciseRows(dayId: string): Promise<ExerciseRow[]> {
  const { data, error } = await supabase
    .from('plan_exercises')
    .select(EX_COLS)
    .eq('day_id', dayId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExerciseRow[];
}

export async function getExerciseRow(rowId: string): Promise<ExerciseRow | null> {
  const { data, error } = await supabase
    .from('plan_exercises')
    .select(EX_COLS)
    .eq('id', rowId)
    .maybeSingle();
  if (error) throw error;
  return (data as ExerciseRow) ?? null;
}

export async function createExerciseRow(input: CreateExerciseRow): Promise<ExerciseRow> {
  const v = createExerciseRowSchema.parse(input);
  const { data, error } = await supabase
    .from('plan_exercises')
    .insert({
      day_id: v.day_id,
      exercise_id: v.exercise_id,
      exercise_name: v.exercise_name,
      block: v.block ?? 'primary',
      position: v.position ?? 0,
      sets: v.sets ?? null,
      reps: v.reps ?? null,
      rest_seconds: v.rest_seconds ?? null,
      tempo: v.tempo ?? null,
      note: v.note ?? null,
    })
    .select(EX_COLS)
    .single();
  if (error) throw error;
  return data as ExerciseRow;
}

export async function updateExerciseRow(rowId: string, input: UpdateExerciseRow): Promise<void> {
  const v = updateExerciseRowSchema.parse(input);
  const { error } = await supabase.from('plan_exercises').update(v).eq('id', rowId);
  if (error) throw error;
}

export async function deleteExerciseRow(rowId: string): Promise<void> {
  const { error } = await supabase.from('plan_exercises').delete().eq('id', rowId);
  if (error) throw error;
}

// ── Nutrition: meals + meal items ────────────────────────────────────────────

export async function listMeals(planId: string): Promise<Meal[]> {
  const { data, error } = await supabase
    .from('plan_meals')
    .select(MEAL_COLS)
    .eq('plan_id', planId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Meal[];
}

export async function createMeal(input: CreateMeal): Promise<Meal> {
  const v = createMealSchema.parse(input);
  const { data, error } = await supabase
    .from('plan_meals')
    .insert({ plan_id: v.plan_id, name: v.name, note: v.note ?? null, position: v.position ?? 0 })
    .select(MEAL_COLS)
    .single();
  if (error) throw error;
  return data as Meal;
}

export async function updateMeal(mealId: string, input: UpdateMeal): Promise<void> {
  const v = updateMealSchema.parse(input);
  const { error } = await supabase.from('plan_meals').update(v).eq('id', mealId);
  if (error) throw error;
}

export async function deleteMeal(mealId: string): Promise<void> {
  const { error } = await supabase.from('plan_meals').delete().eq('id', mealId);
  if (error) throw error;
}

export async function listMealItems(mealId: string): Promise<MealItem[]> {
  const { data, error } = await supabase
    .from('plan_meal_items')
    .select(MEAL_ITEM_COLS)
    .eq('meal_id', mealId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MealItem[];
}

export async function getMealItem(itemId: string): Promise<MealItem | null> {
  const { data, error } = await supabase
    .from('plan_meal_items')
    .select(MEAL_ITEM_COLS)
    .eq('id', itemId)
    .maybeSingle();
  if (error) throw error;
  return (data as MealItem) ?? null;
}

export async function createMealItem(input: CreateMealItem): Promise<MealItem> {
  const v = createMealItemSchema.parse(input);
  const { data, error } = await supabase
    .from('plan_meal_items')
    .insert({
      meal_id: v.meal_id,
      food_id: v.food_id,
      food_name: v.food_name,
      kcal_per_100g: v.kcal_per_100g,
      protein_g_per_100g: v.protein_g_per_100g,
      carbs_g_per_100g: v.carbs_g_per_100g,
      fat_g_per_100g: v.fat_g_per_100g,
      grams: v.grams,
      note: v.note ?? null,
      position: v.position ?? 0,
    })
    .select(MEAL_ITEM_COLS)
    .single();
  if (error) throw error;
  return data as MealItem;
}

export async function updateMealItem(itemId: string, input: UpdateMealItem): Promise<void> {
  const v = updateMealItemSchema.parse(input);
  const { error } = await supabase.from('plan_meal_items').update(v).eq('id', itemId);
  if (error) throw error;
}

export async function deleteMealItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('plan_meal_items').delete().eq('id', itemId);
  if (error) throw error;
}
