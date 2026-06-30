// Data layer for Calls & Meetings (Phase A). Two coach<->client call paths, both fenced
// inside an existing pairing by RLS (migration 0083).
//
// Reads go straight through RLS (each party sees only their own calls; a client sees only
// their coach's OPEN slots). Creating a booking request and cancelling a pending/accepted
// one are RLS-permitted client writes; the coach "Call now" is a direct RLS insert (the
// BEFORE-INSERT trigger force-derives origin/parties). The privileged transitions —
// accept/decline (resolve-call-request) and the lifecycle (transition-call) — live in Edge
// Functions (CLAUDE.md §2). The actual join is resolved on-demand via callProvider.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { joinCall } from './callProvider';

export type CallStatus =
  | 'pending'
  | 'accepted'
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'missed';
export type CallOrigin = 'client_request' | 'coach_adhoc';
export type CallPurpose = 'progress_review' | 'plan_adjustment' | 'form_check' | 'other';
export type SlotStatus = 'open' | 'held' | 'booked' | 'closed';

export const CALL_PURPOSES: CallPurpose[] = ['progress_review', 'plan_adjustment', 'form_check', 'other'];

/** A coach-published bookable slot. */
export type CoachCallSlot = {
  id: string;
  coach_id: string;
  starts_at: string;
  duration_minutes: number;
  status: SlotStatus;
};

/** A scheduled / requested / live call (either origination path). */
export type Call = {
  id: string;
  origin: CallOrigin;
  coach_id: string;
  client_id: string;
  client_name: string | null;
  slot_id: string | null;
  purpose: CallPurpose | null;
  status: CallStatus;
  scheduled_at: string | null;
  duration_minutes: number | null;
  provider: string;
  created_at: string;
};

/** Raised when two clients race for the same slot (the partial unique index rejects the loser). */
export const SLOT_TAKEN = 'slot_taken';
/** Raised when a coach already has a live ad-hoc ring to this client. */
export const CALL_ALREADY_LIVE = 'call_already_live';

const CALL_COLS = 'id, origin, coach_id, client_id, client_name, slot_id, purpose, status, scheduled_at, duration_minutes, provider, created_at';

// ── Client: booking ──────────────────────────────────────────────────────────
/** The signed-in client's coach's OPEN, future slots, soonest first (RLS-scoped). */
export async function listCoachOpenSlots(): Promise<CoachCallSlot[]> {
  const { data, error } = await supabase
    .from('coach_call_slots')
    .select('id, coach_id, starts_at, duration_minutes, status')
    .eq('status', 'open')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CoachCallSlot[];
}

/**
 * Request a slot. Only slot_id + purpose are sent; origin/client_id/coach_id/status are
 * server-set by the BEFORE-INSERT trigger (which also validates the slot is the client's
 * coach's, open, and future). The partial unique index rejects a second active call on the
 * same slot → surfaced as SLOT_TAKEN.
 */
export async function createCallRequest(slotId: string, purpose: CallPurpose): Promise<void> {
  const { error } = await supabase.from('calls').insert({ slot_id: slotId, purpose });
  if (error) {
    if (error.code === '23505') throw new Error(SLOT_TAKEN);
    throw error;
  }
}

/** The signed-in client's calls, newest scheduled first (RLS: client_id = auth.uid()). */
export async function listMyCalls(): Promise<Call[]> {
  const { data, error } = await supabase
    .from('calls')
    .select(CALL_COLS)
    .order('scheduled_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Call[];
}

/** Cancel an own pending/accepted booking (RLS allows client_request pending|accepted → cancelled). */
export async function cancelCall(id: string): Promise<void> {
  const { error } = await supabase.from('calls').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw error;
}

// ── Coach: availability + inbox + ad-hoc ───────────────────────────────────────
/** All of the signed-in coach's slots (RLS: coach_id = auth.uid()), soonest first. */
export async function listMySlots(): Promise<CoachCallSlot[]> {
  const { data, error } = await supabase
    .from('coach_call_slots')
    .select('id, coach_id, starts_at, duration_minutes, status')
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CoachCallSlot[];
}

/** Publish a bookable slot. coach_id must equal auth.uid() (enforced by the RLS WITH CHECK). */
export async function createSlot(coachId: string, startsAtIso: string, durationMinutes: number): Promise<void> {
  const { error } = await supabase
    .from('coach_call_slots')
    .insert({ coach_id: coachId, starts_at: startsAtIso, duration_minutes: durationMinutes });
  if (error) throw error;
}

/** Withdraw an open slot (open → closed) — only allowed while it has no live booking. */
export async function closeSlot(id: string): Promise<void> {
  const { error } = await supabase.from('coach_call_slots').update({ status: 'closed' }).eq('id', id);
  if (error) throw error;
}

/** Re-open a closed slot (closed → open). */
export async function reopenSlot(id: string): Promise<void> {
  const { error } = await supabase.from('coach_call_slots').update({ status: 'open' }).eq('id', id);
  if (error) throw error;
}

/** Delete an open/closed slot (RLS forbids deleting a held/booked one). */
export async function deleteSlot(id: string): Promise<void> {
  const { error } = await supabase.from('coach_call_slots').delete().eq('id', id);
  if (error) throw error;
}

/** The coach's pending booking inbox, oldest first (RLS: coach_id = auth.uid()). */
export async function listCoachCallInbox(): Promise<Call[]> {
  const { data, error } = await supabase
    .from('calls')
    .select(CALL_COLS)
    .eq('origin', 'client_request')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Call[];
}

/** All of the coach's calls, newest scheduled first (RLS: coach_id = auth.uid()). */
export async function listCoachCalls(): Promise<Call[]> {
  const { data, error } = await supabase
    .from('calls')
    .select(CALL_COLS)
    .order('scheduled_at', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Call[];
}

/**
 * Coach starts an ad-hoc "Call now" to one of their clients — a direct RLS insert. The
 * BEFORE-INSERT trigger force-derives origin='coach_adhoc'/status='ringing'/coach_id and
 * validates is_coach_of(client_id). Returns the new call id (to open the room). The unique
 * index rejects a second simultaneous ring to the same client → CALL_ALREADY_LIVE.
 */
export async function startAdhocCall(clientId: string, purpose: CallPurpose = 'other'): Promise<string> {
  const { data, error } = await supabase
    .from('calls')
    .insert({ client_id: clientId, purpose })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(CALL_ALREADY_LIVE);
    throw error;
  }
  return (data as { id: string }).id;
}

/** Coach: start an ad-hoc call to a client and immediately open the room (Phase A: Jitsi). */
export async function startAndJoinCall(clientId: string, purpose: CallPurpose = 'other'): Promise<void> {
  const id = await startAdhocCall(clientId, purpose);
  await joinCall({ id, provider: 'jitsi' });
}

// ── Privileged transitions (Edge Functions, §2) ───────────────────────────────
/** Coach accepts/declines a booking request → resolve-call-request (the only writer). */
export async function resolveCallRequest(callId: string, decision: 'accept' | 'decline'): Promise<void> {
  const { error } = await supabase.functions.invoke('resolve-call-request', {
    body: { call_id: callId, decision },
  });
  if (error) throw error;
}

/** Either party moves a call's lifecycle → transition-call (start/complete/miss/cancel). */
export async function transitionCall(
  callId: string,
  event: 'start' | 'complete' | 'miss' | 'cancel',
): Promise<void> {
  const { error } = await supabase.functions.invoke('transition-call', {
    body: { call_id: callId, event },
  });
  if (error) throw error;
}

// ── Realtime ──────────────────────────────────────────────────────────────────
/**
 * Subscribe ONCE to the caller's call rows (as client OR coach). RLS (calls_select) limits
 * delivered rows to their own. Use a UNIQUE channelKey per subscriber and read changing
 * values from a ref (web.md) — never re-subscribe a fixed-name channel. Drives the
 * incoming-call banner + live list refresh.
 */
export function subscribeToCalls(
  userId: string,
  onChange: (call: Call) => void,
  channelKey: string,
): RealtimeChannel {
  const coerce = (row: unknown): Call => row as Call;
  return supabase
    .channel(`calls:${channelKey}:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'calls', filter: `client_id=eq.${userId}` },
      (p) => onChange(coerce(p.new)),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'calls', filter: `coach_id=eq.${userId}` },
      (p) => onChange(coerce(p.new)),
    )
    .subscribe();
}
