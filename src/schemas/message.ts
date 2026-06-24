// Shared Zod contract for coach ⇄ client messages (CLAUDE.md §4, §8). The sender
// is set server-side (a DB trigger forces sender_id = auth.uid()), so it is NOT
// part of this schema — only the recipient and the body are caller-supplied.
import { z } from 'zod';

export const sendMessageSchema = z.object({
  recipient_id: z.string().uuid(),
  // Trim + bound to match the DB check (1..4000 chars). Render must not treat
  // this as HTML (§8) — RN <Text> is inherently safe.
  body: z.string().trim().min(1).max(4000),
  // Optional reply: the quoted message id (must be in the same thread; the server
  // trigger validates the sender can see it).
  reply_to_id: z.string().uuid().optional(),
});
export type SendMessage = z.infer<typeof sendMessageSchema>;

// Soft edit (Phase 18 Slice 2): the sender corrects their OWN recent message. Only
// the body is caller-supplied; edited_at / original_body are server-owned (a trigger
// enforces the sender-only, within-window, not-banned rules).
export const editMessageSchema = z.object({
  message_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});
export type EditMessage = z.infer<typeof editMessageSchema>;

// Reactions (Phase 18 Slice 2): a fixed emoji allowlist mirrored by the DB CHECK in
// 0036. user_id is server-set (a trigger), so it is NOT part of this schema.
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '💪', '🎉'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export const reactToMessageSchema = z.object({
  message_id: z.string().uuid(),
  emoji: z.enum(REACTION_EMOJIS),
});
export type ReactToMessage = z.infer<typeof reactToMessageSchema>;
