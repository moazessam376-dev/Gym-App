// Per-user AI rate limiting on the ai_usage_events ledger (0027), centralized so each
// function doesn't reinvent it (foundations §4). The contract, locked by Phase 12b:
//   1. CHECK the rolling-window count BEFORE the model call.
//   2. RECORD the attempt BEFORE the model call (fail-closed — a crash mid-call still
//      consumes a slot, so a failing request can't burn the provider quota).
// The ledger is append-only + service-role-write-only (its RLS has no INSERT policy),
// so both calls take the service client. `kind` is the per-feature counter key.
import type { SupabaseClient } from '@supabase/supabase-js';
import { costMicros, type AiUsage } from './ai-pricing.ts';

export type AiUsageKind =
  | 'inbody_ocr'
  | 'inbody_insight'
  | 'coach_plan_gen'
  | 'plan_nudge'
  | 'food_macro_fill'
  | 'exercise_swap'
  | 'coach_analytics';

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

/** Backfill an attempt row with model + token usage + integer micro-USD cost AFTER a
 * successful model call (Phase 14c). The attempt is recorded BEFORE the call (fail-closed),
 * so cost — known only post-call — is a follow-up UPDATE by the service role (the ledger
 * has no client write path; service_role bypasses RLS, like refundUsage's DELETE). No-op
 * if the slot was refunded (id cleared) or usage is unavailable. Failed-but-refunded calls
 * are intentionally not cost-recorded (rare; $0 on the free pilot) — a minor undercount. */
export async function recordCost(
  svc: SupabaseClient,
  id: string | null,
  usage: AiUsage | null,
): Promise<void> {
  if (!id || !usage) return;
  // Cost accounting is SECONDARY — it must never fail the actual AI feature. Swallow
  // any error (e.g. the 0030 columns not yet applied, a transient DB blip) and log
  // it server-side; the user's successful call still returns normally.
  try {
    await svc
      .from('ai_usage_events')
      .update({
        model: usage.model,
        tokens_in: usage.tokensIn,
        tokens_out: usage.tokensOut,
        cost_micros: costMicros(usage.model, usage.tokensIn, usage.tokensOut),
      })
      .eq('id', id);
  } catch (e) {
    console.error('recordCost failed (non-fatal)', { message: String(e) });
  }
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
