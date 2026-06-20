// Shared Zod contract for the exercise & food libraries (CLAUDE.md §4). Allowlist
// fields only; `coach_id` is server-controlled (set to auth.uid() by RLS intent,
// never client-chosen) and deliberately excluded — a coach can only create their
// OWN custom entries, never a global or another coach's.
import { z } from 'zod';

export const muscleGroupSchema = z.enum(['push', 'pull', 'legs', 'upper', 'lower', 'core']);
export type MuscleGroup = z.infer<typeof muscleGroupSchema>;

export const createExerciseSchema = z.object({
  name: z.string().min(1).max(120),
  muscle_group: muscleGroupSchema,
  primary_muscle: z.string().max(80).nullable().optional(),
});
export type CreateExercise = z.infer<typeof createExerciseSchema>;

// Macros are integers per 100g (money.md discipline — never floats).
export const createFoodSchema = z.object({
  name: z.string().min(1).max(120),
  kcal_per_100g: z.number().int().min(0).max(2000),
  protein_g_per_100g: z.number().int().min(0).max(100),
  carbs_g_per_100g: z.number().int().min(0).max(100),
  fat_g_per_100g: z.number().int().min(0).max(100),
});
export type CreateFood = z.infer<typeof createFoodSchema>;
