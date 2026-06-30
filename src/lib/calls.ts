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

// ── Recurring weekly availability (Calendly model, 0085) ──────────────────────
export type CoachAvailability = { coach_id: string; weekday: number; start_minute: number; end_minute: number };

/** The coach's weekly windows — readable by the coach (own) or their clients (booking sheet). */
export async function listCoachAvailability(): Promise<CoachAvailability[]> {
  const { data, error } = await supabase
    .from('coach_availability')
    .select('coach_id, weekday, start_minute, end_minute');
  if (error) throw error;
  return (data ?? []) as CoachAvailability[];
}

/** Upsert a coach's window for one weekday (0=Sun). Minutes are local minutes-from-midnight. */
export async function setCoachAvailability(
  coachId: string,
  weekday: number,
  startMinute: number,
  endMinute: number,
): Promise<void> {
  const { error } = await supabase
    .from('coach_availability')
    .upsert({ coach_id: coachId, weekday, start_minute: startMinute, end_minute: endMinute }, { onConflict: 'coach_id,weekday' });
  if (error) throw error;
}

/** Remove a coach's window for one weekday (the day becomes unavailable). */
export async function clearCoachAvailabilityDay(coachId: string, weekday: number): Promise<void> {
  const { error } = await supabase.from('coach_availability').delete().eq('coach_id', coachId).eq('weekday', weekday);
  if (error) throw error;
}

/** The coach's busy start-times (no client identity) so the booking sheet can grey them out. */
export async function listCoachBookedTimes(coachId: string): Promise<{ scheduled_at: string; duration_minutes: number | null }[]> {
  const { data, error } = await supabase.rpc('coach_booked_times', { p_coach: coachId });
  if (error) throw error;
  return (data ?? []) as { scheduled_at: string; duration_minutes: number | null }[];
}

/** Book a TIME within the coach's working hours (slotless). The trigger validates future +
 *  duration + sets the parties; the exact-start unique index rejects a clash → SLOT_TAKEN. */
export async function createCallRequestAtTime(scheduledAtIso: string, durationMinutes: number, purpose: CallPurpose): Promise<void> {
  const { error } = await supabase
    .from('calls')
    .insert({ scheduled_at: scheduledAtIso, duration_minutes: durationMinutes, purpose });
  if (error) {
    if (error.code === '23505') throw new Error(SLOT_TAKEN);
    throw error;
  }
}

/** Compute bookable LOCAL start-times from the coach's weekly windows over the next `days`,
 *  at `duration` minutes (stepped every 30 min), excluding past times and any that OVERLAP an
 *  already-booked call. Pure client-side (single-region pilot: same tz on both sides). */
export function deriveBookableTimes(
  windows: CoachAvailability[],
  booked: { scheduled_at: string; duration_minutes: number | null }[],
  durationMinutes: number,
  days = 21,
  stepMinutes = 30,
): Date[] {
  const now = Date.now();
  const byWeekday = new Map<number, CoachAvailability>();
  for (const w of windows) byWeekday.set(w.weekday, w);
  const ranges = booked
    .filter((b) => b.scheduled_at)
    .map((b) => {
      const s = new Date(b.scheduled_at).getTime();
      return [s, s + (b.duration_minutes ?? 30) * 60_000] as [number, number];
    });
  const out: Date[] = [];
  const base = new Date();
  for (let d = 0; d < days; d++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
    const w = byWeekday.get(day.getDay());
    if (!w) continue;
    for (let m = w.start_minute; m + durationMinutes <= w.end_minute; m += stepMinutes) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m).getTime();
      if (start <= now) continue;
      const end = start + durationMinutes * 60_000;
      if (ranges.some(([bs, be]) => start < be && end > bs)) continue; // overlaps a booking
      out.push(new Date(start));
    }
  }
  return out;
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
/** Raised only when the session is genuinely dead (token refresh failed) → prompt re-login. */
export const AUTH_EXPIRED = 'auth_expired';

/**
 * Invoke an Edge Function, recovering from a STALE access token. The functions gateway
 * (verify_jwt) returns 401 on an expired/revoked token even while REST reads still work
 * (the in-session gotcha the founder hit). On a 401 we refresh the session ONCE and retry,
 * so a real user never sees the failure; only a genuinely-dead session (refresh fails)
 * surfaces AUTH_EXPIRED for the UI to prompt a re-login. A non-401 error (e.g. a business
 * request_invalid 400) is surfaced unchanged.
 */
async function invokeAuthed(fn: string, body: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.functions.invoke(fn, { body });
  if (!error) return;
  const status = (error as { context?: { status?: number } }).context?.status;
  if (status !== 401) throw error;
  const { data, error: refreshErr } = await supabase.auth.refreshSession();
  if (refreshErr || !data.session) throw new Error(AUTH_EXPIRED);
  const { error: retryErr } = await supabase.functions.invoke(fn, { body });
  if (retryErr) throw retryErr;
}

/** Coach accepts/declines a booking request → resolve-call-request (the only writer). */
export async function resolveCallRequest(callId: string, decision: 'accept' | 'decline'): Promise<void> {
  await invokeAuthed('resolve-call-request', { call_id: callId, decision });
}

/** Either party moves a call's lifecycle → transition-call (start/complete/miss/cancel). */
export async function transitionCall(
  callId: string,
  event: 'start' | 'complete' | 'miss' | 'cancel',
): Promise<void> {
  await invokeAuthed('transition-call', { call_id: callId, event });
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
