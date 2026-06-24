import { z } from 'zod';

// Per-user notification preferences (Phase 17). One boolean per event type. Used to
// validate the client write before the notification_prefs upsert (CLAUDE.md §4 — every
// mutation is Zod-validated; allowlist fields, never spread untrusted input).
export const notificationPrefsSchema = z.object({
  message: z.boolean(),
  coach_comment: z.boolean(),
  plan_published: z.boolean(),
  pr_achieved: z.boolean(),
});

export type NotificationPrefsInput = z.infer<typeof notificationPrefsSchema>;
