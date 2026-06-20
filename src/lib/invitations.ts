// Data layer for the Phase 2 coach ⇄ client flows.
//
// Reads go straight through RLS (a coach sees only their own clients /
// invitations; a client may read their own coach). The two privileged writes —
// assigning coach_id and flipping an invitation's status — are NOT here: they
// live in the accept-invitation / assign-client Edge Functions (CLAUDE.md §2).
// Creating an invitation IS a client-side insert, explicitly allowed by the
// invitations RLS INSERT policy. Inputs are validated with the shared Zod
// schemas before any call (§4).
import { supabase } from './supabase';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  type AcceptInvitation,
  type CreateInvitation,
} from '../schemas/invitation';

export type Client = {
  id: string;
  full_name: string | null;
  /** The email this client was invited with (fallback label when no name yet). */
  invited_email: string | null;
};

export type Coach = {
  id: string;
  full_name: string | null;
};

export type Invitation = {
  id: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string;
};

/** Raised by createInvitation when a pending invite to this email already exists. */
export const DUPLICATE_PENDING_INVITE = 'duplicate_pending_invite';

/**
 * The coach's roster. RLS (`is_coach_of`) returns only this coach's clients. We
 * also pull accepted invitations (the coach owns them) to label clients who
 * haven't set a name yet by the email they were invited with.
 */
export async function listMyClients(): Promise<Client[]> {
  const [clientsRes, invRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'client')
      .order('full_name', { ascending: true, nullsFirst: false }),
    supabase.from('invitations').select('accepted_by, email').eq('status', 'accepted'),
  ]);
  if (clientsRes.error) throw clientsRes.error;

  // The invitations read is best-effort (labels only) — don't fail the roster on it.
  const emailByClient = new Map<string, string>();
  for (const row of invRes.data ?? []) {
    if (row.accepted_by) emailByClient.set(row.accepted_by, row.email);
  }

  return (clientsRes.data ?? []).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    invited_email: emailByClient.get(c.id) ?? null,
  }));
}

/** The signed-in client's coach, or null if unassigned. */
export async function getMyCoach(userId: string): Promise<Coach | null> {
  const { data: me, error: meErr } = await supabase
    .from('profiles')
    .select('coach_id')
    .eq('id', userId)
    .maybeSingle();
  if (meErr) throw meErr;
  if (!me?.coach_id) return null;

  // Readable via the 0008 own-coach policy.
  const { data: coach, error: coErr } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', me.coach_id)
    .maybeSingle();
  if (coErr) throw coErr;
  return coach ?? null;
}

/** The coach's own invitations (RLS scopes to coach_id = auth.uid()). */
export async function listMyInvitations(): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, token, status, created_at, expires_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Invitation[];
}

/**
 * Create a pending invitation. Only `email` is caller-supplied; token, status,
 * expiry come from DB defaults. The RLS INSERT policy enforces coach_id =
 * auth.uid() and a 'coach' role claim. The 0008 partial unique index rejects a
 * second pending invite to the same email — surfaced as DUPLICATE_PENDING_INVITE.
 */
export async function createInvitation(
  coachId: string,
  input: CreateInvitation,
): Promise<Invitation> {
  const { email } = createInvitationSchema.parse(input);
  const { data, error } = await supabase
    .from('invitations')
    .insert({ coach_id: coachId, email })
    .select('id, email, token, status, created_at, expires_at')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(DUPLICATE_PENDING_INVITE);
    throw error;
  }
  return data as Invitation;
}

export type AcceptResult = { ok: true } | { ok: false; reason: 'already_has_coach' | 'invalid' };

/**
 * Redeem an invitation token via the accept-invitation Edge Function (the only
 * writer of coach_id / status). The user's bearer token is attached
 * automatically, so the server resolves the accepting user from the verified
 * JWT. Returns a structured reason: `already_has_coach` (the caller's own state,
 * safe to surface) vs. a generic `invalid` for everything else.
 */
export async function acceptInvitation(input: AcceptInvitation): Promise<AcceptResult> {
  const { token } = acceptInvitationSchema.parse(input);
  const { error } = await supabase.functions.invoke('accept-invitation', {
    body: { token },
  });
  if (!error) return { ok: true };

  let reason: 'already_has_coach' | 'invalid' = 'invalid';
  try {
    const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
    const body = (await ctx?.json?.()) as { error?: string } | undefined;
    if (body?.error === 'already_has_coach') reason = 'already_has_coach';
  } catch {
    /* keep the generic reason */
  }
  return { ok: false, reason };
}
