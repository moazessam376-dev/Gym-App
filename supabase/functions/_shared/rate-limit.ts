// Per-user AI rate limiting on the ai_usage_events ledger (0027), centralized so each
// function doesn't reinvent it (foundations §4). The contract, locked by Phase 12b:
//   1. CHECK the rolling-window count BEFORE the model call.
//   2. RECORD the attempt BEFORE the model call (fail-closed — a crash mid-call still
//      consumes a slot, so a failing request can't burn the provider quota).
// The ledger is append-only + service-role-write-only (its RLS has no INSERT policy),
// so both calls take the service client. `kind` is the per-feature counter key.
import type { SupabaseClient } from '@supabase/supabase-js';

export type AiUsageKind =
  | 'inbody_ocr'
  | 'inbody_insight'
  | 'coach_plan_gen'
  | 'plan_nudge'
  | 'food_macro_fill'
  | 'exercise_swap';

/** True if the user is still UNDER the limit for this kind in the trailing window. */
export async function withinLimit(
  svc: SupabaseClient,
  userId: string,
  kind: AiUsageKind,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await svc
    .from('ai_usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('kind', kind)
    .gte('created_at', since);
  return (count ?? 0) < limit;
}

/** Append one usage row for this user/kind. Call BEFORE the model request (fail-closed).
 * Returns the new row id so a clean failure can REFUND the slot (see refundUsage). */
export async function recordUsage(
  svc: SupabaseClient,
  userId: string,
  kind: AiUsageKind,
  provider: string,
): Promise<string | null> {
  const { data } = await svc
    .from('ai_usage_events')
    .insert({ user_id: userId, kind, provider })
    .select('id')
    .single();
  return (data as { id: string } | null)?.id ?? null;
}

/** Refund a previously-recorded slot when the call produced NOTHING (model/parse error).
 * The slot is recorded before the call (fail-closed) so a true crash still consumes it;
 * but a clean "failed" result shouldn't burn the user's daily quota — especially on the
 * free pilot model, where a retry is expected. (Successful calls keep their slot.) */
export async function refundUsage(svc: SupabaseClient, id: string | null): Promise<void> {
  if (!id) return;
  await svc.from('ai_usage_events').delete().eq('id', id);
}

// Common windows.
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
