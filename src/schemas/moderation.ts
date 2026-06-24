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
