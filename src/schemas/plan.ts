// Shared Zod contract for Phase 3 plans v2 (CLAUDE.md §4). A plan is either a
// coach-owned TEMPLATE (no client) or an assigned copy. Allowlist fields only;
// `coach_id`, `version`, `source_plan_id`, timestamps are server-controlled.
import { z } from 'zod';

export const planTypeSchema = z.enum(['training', 'nutrition']);
export type PlanType = z.infer<typeof planTypeSchema>;

export const planStatusSchema = z.enum(['draft', 'published', 'archived']);
export type PlanStatus = z.infer<typeof planStatusSchema>;

export const trainingBlockSchema = z.enum([
  'warmup',
  'primary',
  'accessory',
  'conditioning',
  'cooldown',
]);
export type TrainingBlock = z.infer<typeof trainingBlockSchema>;

// Create a TEMPLATE (no client). Assigned copies are produced server-side by the
// assign_plan_to_client RPC, never created through this schema.
export const createTemplateSchema = z.object({
  type: planTypeSchema,
  title: z.string().min(1).max(120),
});
export type CreateTemplate = z.infer<typeof createTemplateSchema>;

export const updatePlanSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  status: planStatusSchema.optional(),
});
export type UpdatePlan = z.infer<typeof updatePlanSchema>;

// ── Training hierarchy ───────────────────────────────────────────────────────
export const createDaySchema = z.object({
  plan_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  position: z.number().int().min(0).optional(),
});
export type CreateDay = z.infer<typeof createDaySchema>;

export const updateDaySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  position: z.number().int().min(0).optional(),
});
export type UpdateDay = z.infer<typeof updateDaySchema>;

// reps is free text to allow ranges like "8-12" or "AMRAP".
const repsSchema = z.string().max(40).nullable().optional();

export const createExerciseRowSchema = z.object({
  day_id: z.string().uuid(),
  exercise_id: z.string().uuid(),
  // Display snapshot from the library at authoring time (see migration 0010).
  exercise_name: z.string().min(1).max(120),
  block: trainingBlockSchema.optional(),
  position: z.number().int().min(0).optional(),
  sets: z.number().int().min(0).max(99).nullable().optional(),
  reps: repsSchema,
  rest_seconds: z.number().int().min(0).max(3600).nullable().optional(),
  tempo: z.string().max(40).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateExerciseRow = z.infer<typeof createExerciseRowSchema>;

export const updateExerciseRowSchema = z.object({
  block: trainingBlockSchema.optional(),
  position: z.number().int().min(0).optional(),
  sets: z.number().int().min(0).max(99).nullable().optional(),
  reps: repsSchema,
  rest_seconds: z.number().int().min(0).max(3600).nullable().optional(),
  tempo: z.string().max(40).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type UpdateExerciseRow = z.infer<typeof updateExerciseRowSchema>;

// ── Nutrition hierarchy ──────────────────────────────────────────────────────
export const createMealSchema = z.object({
  plan_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  note: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});
export type CreateMeal = z.infer<typeof createMealSchema>;

export const updateMealSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  note: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});
export type UpdateMeal = z.infer<typeof updateMealSchema>;

export const createMealItemSchema = z.object({
  meal_id: z.string().uuid(),
  food_id: z.string().uuid(),
  // Display + macro snapshot from the food library at authoring time (0010).
  food_name: z.string().min(1).max(120),
  kcal_per_100g: z.number().int().min(0),
  protein_g_per_100g: z.number().int().min(0),
  carbs_g_per_100g: z.number().int().min(0),
  fat_g_per_100g: z.number().int().min(0),
  grams: z.number().int().min(0).max(5000),
  note: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});
export type CreateMealItem = z.infer<typeof createMealItemSchema>;

export const updateMealItemSchema = z.object({
  grams: z.number().int().min(0).max(5000).optional(),
  note: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
});
export type UpdateMealItem = z.infer<typeof updateMealItemSchema>;
