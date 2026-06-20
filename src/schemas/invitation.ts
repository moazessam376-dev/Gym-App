// Shared Zod contract for the invitation / assignment flows (CLAUDE.md §4).
// The app validates against these before calling Supabase; the Edge Functions
// re-validate the same shapes server-side (never trust the client). Allowlist
// fields only — token/status/expiry/coach_id are server-controlled.
import { z } from 'zod';

// A coach creates an invitation. Only `email` is caller-supplied; the token,
// status, expiry, and coach_id come from DB defaults + the invitations RLS
// INSERT policy (coach_id = auth.uid()).
export const createInvitationSchema = z.object({
  email: z.string().email(),
});
export type CreateInvitation = z.infer<typeof createInvitationSchema>;

// An invitee redeems a token (sent to the accept-invitation Edge Function).
export const acceptInvitationSchema = z.object({
  token: z.string().uuid(),
});
export type AcceptInvitation = z.infer<typeof acceptInvitationSchema>;

// A coach assigns an existing client to themselves (assign-client Edge Function).
export const assignClientSchema = z.object({
  client_id: z.string().uuid(),
});
export type AssignClient = z.infer<typeof assignClientSchema>;
