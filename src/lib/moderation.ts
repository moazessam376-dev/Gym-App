// Data layer for chat safety (CLAUDE.md §8). A participant reports a message
// addressed to them — a normal client insert (RLS-gated; the trigger server-sets
// reporter/reported and snapshots the body). The admin queue is an RLS-scoped read
// (reporter or admin). The moderation decision (dismiss / ban / unban) is NOT here —
// it routes through the moderate-message-report Edge Function, the only writer of
// report status + the ban (§2). Inputs Zod-validated.
import { supabase } from './supabase';
import {
  moderateReportSchema,
  reportMessageSchema,
  type ModerateReport,
  type ReportMessage,
} from '../schemas/moderation';

export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export type MessageReport = {
  id: string;
  message_id: string;
  reporter_id: string;
  reported_user_id: string;
  reason: string;
  note: string | null;
  reported_body: string | null;
  status: ReportStatus;
  created_at: string;
};

// Admin queue row enriched with the two parties' names + the reported user's ban state.
export type OpenReport = MessageReport & {
  reporter_name: string | null;
  reported_name: string | null;
  reported_banned: boolean;
};

const REPORT_COLS =
  'id, message_id, reporter_id, reported_user_id, reason, note, reported_body, status, created_at';

/**
 * A participant reports a message addressed to them. reporter_id / reported_user_id
 * and the body snapshot are server-set by the trigger; RLS enforces that the caller
 * is the message's recipient. A second report on the same message is a no-op conflict.
 */
export async function reportMessage(input: ReportMessage): Promise<void> {
  const v = reportMessageSchema.parse(input);
  const { error } = await supabase
    .from('message_reports')
    .insert({ message_id: v.message_id, reason: v.reason, note: v.note ?? null });
  if (error) throw error;
}

/**
 * Admin: the open moderation queue with reporter/reported names + ban state. Reads
 * the snapshot body from the report itself (admins have NO DM read override, §8).
 * profiles are admin-readable; the embeds resolve through the named FKs.
 */
export async function listOpenReports(): Promise<OpenReport[]> {
  const { data, error } = await supabase
    .from('message_reports')
    .select(
      `${REPORT_COLS},
       reporter:profiles!message_reports_reporter_id_fkey(full_name),
       reported:profiles!message_reports_reported_user_id_fkey(full_name, banned_at)`,
    )
    .eq('status', 'open')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    // PostgREST types an embedded to-one as an array; normalize to one row.
    const r = row as MessageReport & {
      reporter: { full_name: string | null } | { full_name: string | null }[] | null;
      reported:
        | { full_name: string | null; banned_at: string | null }
        | { full_name: string | null; banned_at: string | null }[]
        | null;
    };
    const reporter = Array.isArray(r.reporter) ? r.reporter[0] : r.reporter;
    const reported = Array.isArray(r.reported) ? r.reported[0] : r.reported;
    const { reporter: _r, reported: _d, ...rest } = r;
    return {
      ...rest,
      reporter_name: reporter?.full_name ?? null,
      reported_name: reported?.full_name ?? null,
      reported_banned: reported?.banned_at != null,
    };
  });
}

/** Admin: resolve a report (dismiss / ban / unban) via the Edge Function. */
export async function moderateReport(input: ModerateReport): Promise<void> {
  const body = moderateReportSchema.parse(input);
  const { error } = await supabase.functions.invoke('moderate-message-report', { body });
  if (error) throw error;
}
