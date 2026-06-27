// Shared Zod contract for the "request a coach" funnel (Slice G2, CLAUDE.md §4).
// The app validates against these before calling Supabase; the resolve Edge Function
// re-validates server-side. Allowlist fields only — client_id / status / resolved_* are
// server-controlled (the BEFORE-INSERT trigger + resolve_coach_request).
import { z } from 'zod';

// A client requests a coach. Only the target coach + an optional note are caller-supplied.
export const createCoachRequestSchema = z.object({
  coach_id: z.string().uuid(),
  message: z.string().max(500).optional(),
});
export type CreateCoachRequest = z.infer<typeof createCoachRequestSchema>;

// A coach accepts / declines a request (resolve-coach-request Edge Function).
export const resolveCoachRequestSchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(['accept', 'decline']),
});
export type ResolveCoachRequest = z.infer<typeof resolveCoachRequestSchema>;
