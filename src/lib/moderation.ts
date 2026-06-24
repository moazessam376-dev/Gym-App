// Data layer for chat safety (CLAUDE.md §8). A participant reports a message
// addressed to them — a normal client insert (RLS-gated; the trigger server-sets
// reporter/reported and snapshots the body). The admin queue is an RLS-scoped read
// (reporter or admin). The moderation decision (dismiss / ban / unban) is NOT here —
// it routes through the moderate-message-report Edge Function, the only writer of
// report status + the ban (§2). Inputs Zod-validated.
import { supabase } from './supabase';
import {
  banAppealSchema,
  moderateReportSchema,
  reportMessageSchema,
  resolveAppealSchema,
  type ModerateReport,
  type ReportMessage,
  type ResolveAppeal,
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

// A currently-banned account the admin can lift the ban on. Carries the report that
// banned them so the unban reuses the same audited moderate_message_report path.
export type BannedUser = {
  report_id: string;
  user_id: string;
  name: string | null;
  banned_at: string | null;
};

// An open ban appeal in the admin review queue, with the appellant's name.
export type OpenAppeal = {
  id: string;
  user_id: string;
  user_name: string | null;
  note: string;
  created_at: string;
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

/**
 * Admin: currently-banned accounts, with the report that banned them so an Unban
 * reuses moderate_message_report (the only writer of the ban). Every ban flows
 * through a report (the only product path that sets banned_at), so a still-banned
 * user always has an `actioned` report here — this makes unban reliably reachable
 * even after the report left the open queue. Deduped to the latest report per user.
 */
export async function listBannedUsers(): Promise<BannedUser[]> {
  const { data, error } = await supabase
    .from('message_reports')
    .select(
      `id, reported_user_id, created_at,
       reported:profiles!message_reports_reported_user_id_fkey(full_name, banned_at)`,
    )
    .eq('status', 'actioned')
    .order('created_at', { ascending: false });
  if (error) throw error;

  const byUser = new Map<string, BannedUser>();
  for (const row of data ?? []) {
    const r = row as {
      id: string;
      reported_user_id: string;
      reported:
        | { full_name: string | null; banned_at: string | null }
        | { full_name: string | null; banned_at: string | null }[]
        | null;
    };
    const reported = Array.isArray(r.reported) ? r.reported[0] : r.reported;
    if (!reported?.banned_at) continue; // only still-banned users
    if (byUser.has(r.reported_user_id)) continue; // keep the latest (rows are desc)
    byUser.set(r.reported_user_id, {
      report_id: r.id,
      user_id: r.reported_user_id,
      name: reported.full_name ?? null,
      banned_at: reported.banned_at,
    });
  }
  return [...byUser.values()];
}

/** Admin: resolve a report (dismiss / ban / unban) via the Edge Function. */
export async function moderateReport(input: ModerateReport): Promise<void> {
  const body = moderateReportSchema.parse(input);
  const { error } = await supabase.functions.invoke('moderate-message-report', { body });
  if (error) throw error;
}

/**
 * Whether the signed-in user is banned (banned_at set). A banned user can still read
 * their own profile row (RLS allows id = auth.uid()), so this powers the in-chat
 * "you're blocked" notice without any server override.
 */
export async function fetchMyBanState(myUserId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('banned_at')
    .eq('id', myUserId)
    .maybeSingle();
  if (error) throw error;
  return data?.banned_at != null;
}

// ── Ban appeals (Phase 18 Slice 3) ───────────────────────────────────────────

/**
 * A banned user appeals their ban. user_id + the workflow columns are server-set by
 * the trigger, which also rejects the insert unless the caller is actually banned.
 * A second appeal while one is open is a no-op conflict (unique partial index).
 */
export async function submitBanAppeal(note: string): Promise<void> {
  const v = banAppealSchema.parse({ note });
  const { error } = await supabase.from('ban_appeals').insert({ note: v.note });
  // Already has an open appeal → unique violation; treat as success (idempotent).
  if (error && error.code !== '23505') throw error;
}

/** Whether the signed-in user already has an OPEN appeal (drives "Appeal pending"). */
export async function fetchMyOpenAppeal(myUserId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('ban_appeals')
    .select('id')
    .eq('user_id', myUserId)
    .eq('status', 'open')
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/** Admin: the open ban-appeal queue with the appellant's name (oldest first). */
export async function listOpenAppeals(): Promise<OpenAppeal[]> {
  const { data, error } = await supabase
    .from('ban_appeals')
    .select(
      `id, user_id, note, created_at,
       user:profiles!ban_appeals_user_id_fkey(full_name)`,
    )
    .eq('status', 'open')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      user_id: string;
      note: string;
      created_at: string;
      user: { full_name: string | null } | { full_name: string | null }[] | null;
    };
    const user = Array.isArray(r.user) ? r.user[0] : r.user;
    return {
      id: r.id,
      user_id: r.user_id,
      note: r.note,
      created_at: r.created_at,
      user_name: user?.full_name ?? null,
    };
  });
}

/** Admin: resolve an appeal (approve = unban / reject) via the Edge Function. */
export async function resolveAppeal(input: ResolveAppeal): Promise<void> {
  const body = resolveAppealSchema.parse(input);
  const { error } = await supabase.functions.invoke('resolve-ban-appeal', { body });
  if (error) throw error;
}

// ── Chat disclaimer acknowledgment (Phase 18 Slice 3) ────────────────────────

/** Whether the signed-in user already accepted the chat terms for this peer. */
export async function fetchChatAcknowledged(myUserId: string, peerId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('chat_acknowledgments')
    .select('peer_id')
    .eq('user_id', myUserId)
    .eq('peer_id', peerId)
    .maybeSingle();
  if (error) throw error;
  return data != null;
}

/** Record acceptance of the chat disclaimer for this peer (user_id is server-set). */
export async function acknowledgeChatTerms(peerId: string): Promise<void> {
  const { error } = await supabase.from('chat_acknowledgments').insert({ peer_id: peerId });
  // Re-accept (already recorded) → unique violation; treat as success (idempotent).
  if (error && error.code !== '23505') throw error;
}
