// Data layer for the "request a coach" funnel (Slice G2). An unassigned client requests a
// public coach; the coach accepts (links them) or declines from an inbox.
//
// Reads go straight through RLS (a client sees their own requests; a coach sees requests
// addressed to them — client_name is snapshotted on the row so the coach can see who's
// asking even though the requester isn't their client yet). The privileged writes —
// accept/decline + the coach_id link — live in the resolve-coach-request Edge Function
// (CLAUDE.md §2); creating + cancelling are RLS-permitted client writes.
import { supabase } from './supabase';
import { createCoachRequestSchema, type ResolveCoachRequest } from '../schemas/coach-request';

export type CoachRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

/** A client's own request — powers the coach-profile CTA state. */
export type MyCoachRequest = {
  id: string;
  coach_id: string;
  status: CoachRequestStatus;
  created_at: string;
};

/** An incoming request in the coach's inbox (client_name snapshotted at request time). */
export type IncomingCoachRequest = {
  id: string;
  client_id: string;
  client_name: string | null;
  message: string | null;
  created_at: string;
};

/** Raised by createCoachRequest when a pending request to this coach already exists. */
export const DUPLICATE_PENDING_REQUEST = 'duplicate_pending_request';

/**
 * Create a pending request to a coach. Only coach_id + an optional note are sent; client_id
 * / status are server-set by the BEFORE-INSERT trigger, which also enforces that the caller
 * is an unassigned client and the target is a public coach. The partial unique index rejects
 * a second pending request to the same coach → surfaced as DUPLICATE_PENDING_REQUEST.
 */
export async function createCoachRequest(coachId: string, message?: string): Promise<void> {
  const parsed = createCoachRequestSchema.parse({ coach_id: coachId, message: message?.trim() || undefined });
  const { error } = await supabase
    .from('coach_requests')
    .insert({ coach_id: parsed.coach_id, message: parsed.message ?? null });
  if (error) {
    if (error.code === '23505') throw new Error(DUPLICATE_PENDING_REQUEST);
    throw error;
  }
}

/** The signed-in client's own requests, newest first (RLS-scoped). */
export async function listMyCoachRequests(): Promise<MyCoachRequest[]> {
  const { data, error } = await supabase
    .from('coach_requests')
    .select('id, coach_id, status, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MyCoachRequest[];
}

/** Cancel a pending request (RLS allows the owner to move pending → cancelled only). */
export async function cancelCoachRequest(id: string): Promise<void> {
  const { error } = await supabase.from('coach_requests').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw error;
}

/** The coach's pending inbox, oldest first (RLS scopes to coach_id = auth.uid()). */
export async function listIncomingCoachRequests(): Promise<IncomingCoachRequest[]> {
  const { data, error } = await supabase
    .from('coach_requests')
    .select('id, client_id, client_name, message, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as IncomingCoachRequest[];
}

/** Accept or decline a request → the resolve-coach-request Edge fn (the only writer). */
export async function resolveCoachRequest(input: ResolveCoachRequest): Promise<void> {
  const { error } = await supabase.functions.invoke('resolve-coach-request', { body: input });
  if (error) throw error;
}
