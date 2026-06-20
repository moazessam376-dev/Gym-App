// Server-side Zod contracts for the assignment Edge Functions (§4). The app
// validates the same shapes before calling (src/schemas/invitation.ts), but the
// server NEVER trusts the client and re-validates here. Allowlist fields only —
// no req.body spread.
import { z } from 'zod';

export const acceptInvitationSchema = z.object({
  token: z.string().uuid(),
});

export const assignClientSchema = z.object({
  client_id: z.string().uuid(),
});
