// Shared Zod contract for the coach-application / onboarding flow (CLAUDE.md §4).
// Allowlist fields only; status/reviewed_* are server-controlled.
import { z } from 'zod';

export const applicationStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

// A client applies. Only an optional message is caller-supplied.
export const createApplicationSchema = z.object({
  message: z.string().max(500).optional(),
});
export type CreateApplication = z.infer<typeof createApplicationSchema>;

// An admin reviews (sent to the review-coach-application Edge Function).
export const reviewApplicationSchema = z.object({
  application_id: z.string().uuid(),
  approve: z.boolean(),
});
export type ReviewApplication = z.infer<typeof reviewApplicationSchema>;
