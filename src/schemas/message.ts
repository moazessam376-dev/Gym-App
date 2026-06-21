// Shared Zod contract for coach ⇄ client messages (CLAUDE.md §4, §8). The sender
// is set server-side (a DB trigger forces sender_id = auth.uid()), so it is NOT
// part of this schema — only the recipient and the body are caller-supplied.
import { z } from 'zod';

export const sendMessageSchema = z.object({
  recipient_id: z.string().uuid(),
  // Trim + bound to match the DB check (1..4000 chars). Render must not treat
  // this as HTML (§8) — RN <Text> is inherently safe.
  body: z.string().trim().min(1).max(4000),
});
export type SendMessage = z.infer<typeof sendMessageSchema>;
