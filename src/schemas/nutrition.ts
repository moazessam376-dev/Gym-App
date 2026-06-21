// Zod contract for food logging + daily macro targets (migration 0019), per
// CLAUDE.md §4 / foundations §2. Allowlist only: `user_id` and `set_by` are
// server-set (BEFORE-INSERT trigger / RLS), never accepted from the client. All
// quantities are integers (foundations §3) — grams, kcal, macro grams.
import { z } from 'zod';

export const mealSlotSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export type MealSlot = z.infer<typeof mealSlotSchema>;

// auto_estimated = TDEE estimate · self_set = athlete-typed · coach_set = coach
// override · from_plan = computed from the assigned nutrition plan.
export const targetSourceSchema = z.enum(['auto_estimated', 'self_set', 'coach_set', 'from_plan']);
export type TargetSource = z.infer<typeof targetSourceSchema>;

// 'YYYY-MM-DD' calendar date.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date');

// Per-100g macro bounds mirror createFoodSchema (src/schemas/library.ts).
const kcal100 = z.number().int().min(0).max(2000);
const macro100 = z.number().int().min(0).max(100);

// Create a diary entry. The macro snapshot is taken at log time (from the picked
// food_library row or a quick-add). `food_id`/`plan_meal_item_id` are optional
// links — null food_id = quick-add, null plan_meal_item_id = an off-plan extra.
export const createFoodLogSchema = z.object({
  log_date: isoDate.optional(),
  meal_slot: mealSlotSchema,
  food_id: z.string().uuid().nullable().optional(),
  plan_meal_item_id: z.string().uuid().nullable().optional(),
  food_name: z.string().min(1).max(120),
  kcal_per_100g: kcal100,
  protein_g_per_100g: macro100,
  carbs_g_per_100g: macro100,
  fat_g_per_100g: macro100,
  grams: z.number().int().min(0).max(5000),
  note: z.string().max(500).nullable().optional(),
});
export type CreateFoodLog = z.infer<typeof createFoodLogSchema>;

// Edit an existing entry — only the mutable fields; never `user_id`.
export const updateFoodLogSchema = z.object({
  meal_slot: mealSlotSchema.optional(),
  food_name: z.string().min(1).max(120).optional(),
  kcal_per_100g: kcal100.optional(),
  protein_g_per_100g: macro100.optional(),
  carbs_g_per_100g: macro100.optional(),
  fat_g_per_100g: macro100.optional(),
  grams: z.number().int().min(0).max(5000).optional(),
  note: z.string().max(500).nullable().optional(),
});
export type UpdateFoodLog = z.infer<typeof updateFoodLogSchema>;

// Upsert the athlete's current daily target. `user_id`/`set_by` are server-set.
export const upsertTargetsSchema = z.object({
  kcal_target: z.number().int().min(0).max(10000),
  protein_g_target: z.number().int().min(0).max(1000),
  carbs_g_target: z.number().int().min(0).max(1000),
  fat_g_target: z.number().int().min(0).max(1000),
  source: targetSourceSchema,
});
export type UpsertTargets = z.infer<typeof upsertTargetsSchema>;
