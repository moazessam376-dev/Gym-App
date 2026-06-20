// Shared Zod contract for Phase 3 plans (CLAUDE.md §4). The app validates against
// these before any write; allowlist fields only — `coach_id`, `version`, and the
// timestamps are server-controlled and deliberately excluded.
import { z } from 'zod';

export const planTypeSchema = z.enum(['training', 'nutrition']);
export type PlanType = z.infer<typeof planTypeSchema>;

export const planStatusSchema = z.enum(['draft', 'published', 'archived']);
export type PlanStatus = z.infer<typeof planStatusSchema>;

// payload holds type-specific structured fields (sets/reps, macros, …). Kept
// open here but validated per-type at the call site; numbers stay integers.
const payloadSchema = z.record(z.string(), z.unknown());

export const createPlanSchema = z.object({
  client_id: z.string().uuid(),
  type: planTypeSchema,
  title: z.string().min(1).max(120),
});
export type CreatePlan = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  status: planStatusSchema.optional(),
});
export type UpdatePlan = z.infer<typeof updatePlanSchema>;

export const createPlanItemSchema = z.object({
  plan_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
  payload: payloadSchema.optional(),
});
export type CreatePlanItem = z.infer<typeof createPlanItemSchema>;

export const updatePlanItemSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
  position: z.number().int().min(0).optional(),
  payload: payloadSchema.optional(),
});
export type UpdatePlanItem = z.infer<typeof updatePlanItemSchema>;
