// Zod contract for completion logging (migration 0016), per CLAUDE.md §4.
// Allowlist fields only — `user_id` is set server-side from auth.uid() (never
// client-supplied), and `completed_at` is set by the data layer, not the caller.
import { z } from 'zod';

// Lenient UUID (matches src/schemas/plan.ts): any 8-4-4-4-12 hex, since seeded
// global ids aren't RFC-4122-versioned.
const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid id');

// Calendar date 'YYYY-MM-DD' (the client passes its device-local date).
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date');

export const sessionStatusSchema = z.enum(['in_progress', 'completed', 'skipped']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const createSessionSchema = z.object({
  plan_id: uuid.nullable().optional(),
  day_id: uuid.nullable().optional(),
  session_date: isoDate.optional(),
  status: sessionStatusSchema.optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateSession = z.infer<typeof createSessionSchema>;

export const updateSessionSchema = z.object({
  status: sessionStatusSchema.optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type UpdateSession = z.infer<typeof updateSessionSchema>;

export const createSetLogSchema = z.object({
  session_id: uuid,
  plan_exercise_id: uuid.nullable().optional(),
  exercise_name: z.string().min(1).max(120),
  set_index: z.number().int().min(0).max(99),
  reps_done: z.number().int().min(0).max(9999).nullable().optional(),
  load_grams: z.number().int().min(0).max(100_000_000).nullable().optional(),
  is_completed: z.boolean().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateSetLog = z.infer<typeof createSetLogSchema>;

export const updateSetLogSchema = z.object({
  reps_done: z.number().int().min(0).max(9999).nullable().optional(),
  load_grams: z.number().int().min(0).max(100_000_000).nullable().optional(),
  is_completed: z.boolean().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type UpdateSetLog = z.infer<typeof updateSetLogSchema>;
