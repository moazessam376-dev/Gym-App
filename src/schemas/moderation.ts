// Shared Zod contracts for chat safety (CLAUDE.md §4, §8). The reporter and the
// reported user are set server-side (a DB trigger derives them from the message),
// so they are NOT part of the report schema — only the message + reason + an
// optional note are caller-supplied. The moderation decision is admin-only and
// routes through an Edge Function.
import { z } from 'zod';

export const REPORT_REASONS = ['harassment', 'spam', 'inappropriate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const reportMessageSchema = z.object({
  message_id: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  // Bound to match the DB check (≤ 1000). Render must not treat this as HTML (§8).
  note: z.string().trim().max(1000).optional(),
});
export type ReportMessage = z.infer<typeof reportMessageSchema>;

export const moderateReportSchema = z.object({
  report_id: z.string().uuid(),
  decision: z.enum(['dismiss', 'ban', 'unban']),
});
export type ModerateReport = z.infer<typeof moderateReportSchema>;

// A banned user appeals their ban (Phase 18 Slice 3). user_id + workflow columns are
// server-set by a DB trigger, so only the note is caller-supplied. The trigger also
// requires the caller to actually be banned.
export const banAppealSchema = z.object({
  // Bound to match the DB check (1..1000). Render must not treat this as HTML (§8).
  note: z.string().trim().min(1).max(1000),
});
export type BanAppeal = z.infer<typeof banAppealSchema>;

// Admin resolves an appeal — approve (unban) or reject. Routes through an Edge Function.
export const resolveAppealSchema = z.object({
  appeal_id: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});
export type ResolveAppeal = z.infer<typeof resolveAppealSchema>;
