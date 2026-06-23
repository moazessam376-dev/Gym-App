// Client entry points for coach-side AI (Phase 13). Each wraps a coach-only Edge
// Function and returns a typed { status } the UI branches on. A non-2xx / transport
// error is mapped to 'failed' — we never surface raw error detail to the user (§4).
// These are COACH tools: the functions enforce coach-of-client server-side; the UI
// only shows the triggers to coaches. All AI text comes back in English.
import { supabase } from './supabase';
import type { PlanType } from '../schemas/plan';

// ── Plan generation (coach-plan-gen) ────────────────────────────────────────
export type PlanGenStatus =
  | 'generated' // a draft plan was created (plan_id returned) — open the editor
  | 'no_profile' // the client hasn't completed their profile — can't personalize
  | 'rate_limited' // hit the per-coach daily cap (§9)
  | 'failed';
export type PlanGenResult = { status: PlanGenStatus; plan_id?: string };

/** Draft a training or nutrition plan for a client. `coachPrompt` is optional steering;
 *  `weeks` (1–4, training only) lets the AI write multiple progressive weeks. */
export async function generatePlan(input: {
  clientId: string;
  type: PlanType;
  weeks?: number;
  coachPrompt?: string;
}): Promise<PlanGenResult> {
  const { data, error } = await supabase.functions.invoke('coach-plan-gen', {
    body: {
      client_id: input.clientId,
      type: input.type,
      weeks: input.type === 'training' ? input.weeks : undefined,
      coach_prompt: input.coachPrompt || undefined,
    },
  });
  if (error || !data || typeof (data as PlanGenResult).status !== 'string') {
    return { status: 'failed' };
  }
  return data as PlanGenResult;
}

// ── Adjust an existing DRAFT plan (coach-plan-adjust) ───────────────────────
export type PlanAdjustStatus = 'adjusted' | 'not_draft' | 'rate_limited' | 'failed';
export type PlanAdjustResult = { status: PlanAdjustStatus; plan_id?: string };

/** Rewrite a DRAFT plan's contents from a coach instruction (typed or seeded from a nudge). */
export async function adjustPlan(planId: string, coachPrompt?: string): Promise<PlanAdjustResult> {
  const { data, error } = await supabase.functions.invoke('coach-plan-adjust', {
    body: { plan_id: planId, coach_prompt: coachPrompt || undefined },
  });
  if (error || !data || typeof (data as PlanAdjustResult).status !== 'string') {
    return { status: 'failed' };
  }
  return data as PlanAdjustResult;
}

// ── Plan-adjustment nudges (coach-plan-nudge) ───────────────────────────────
export type NudgeStatus = 'analyzed' | 'no_data' | 'rate_limited' | 'failed';
export type NudgeResult = { status: NudgeStatus; analysis?: string };

/** Generate coach-only suggestions to adjust a client's plan from their recent logging. */
export async function requestPlanNudge(clientId: string, coachPrompt?: string): Promise<NudgeResult> {
  const { data, error } = await supabase.functions.invoke('coach-plan-nudge', {
    body: { client_id: clientId, coach_prompt: coachPrompt || undefined },
  });
  if (error || !data || typeof (data as NudgeResult).status !== 'string') {
    return { status: 'failed' };
  }
  return data as NudgeResult;
}

/** Read the stored coach-only nudge for a client (RLS hides it from the athlete). */
export async function getPlanInsight(clientId: string): Promise<{ analysis: string; updated_at: string } | null> {
  const { data, error } = await supabase
    .from('plan_insights')
    .select('analysis, updated_at')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw error;
  return (data as { analysis: string; updated_at: string }) ?? null;
}

// ── Utility: custom-food macro autofill (coach-food-macros) ──────────────────
export type FoodMacros = {
  kcal_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
};
export type FoodMacrosStatus = 'filled' | 'rate_limited' | 'failed';
export type FoodMacrosResult = { status: FoodMacrosStatus; macros?: FoodMacros };

/** Estimate per-100g macros for a food name (understands Arabic names). No storage. */
export async function suggestFoodMacros(name: string, coachPrompt?: string): Promise<FoodMacrosResult> {
  const { data, error } = await supabase.functions.invoke('coach-food-macros', {
    body: { name, coach_prompt: coachPrompt || undefined },
  });
  if (error || !data || typeof (data as FoodMacrosResult).status !== 'string') {
    return { status: 'failed' };
  }
  return data as FoodMacrosResult;
}

// ── Utility: injury-aware exercise swaps (coach-exercise-swap) ───────────────
export type SwapSuggestion = { exercise_id: string; name: string; reason: string };
export type SwapStatus = 'suggested' | 'rate_limited' | 'failed';
export type SwapResult = { status: SwapStatus; suggestions?: SwapSuggestion[] };

/** Suggest library exercises to replace one, factoring in the client's injuries. */
export async function suggestExerciseSwap(input: {
  clientId: string;
  exerciseId: string;
  coachPrompt?: string;
}): Promise<SwapResult> {
  const { data, error } = await supabase.functions.invoke('coach-exercise-swap', {
    body: { client_id: input.clientId, exercise_id: input.exerciseId, coach_prompt: input.coachPrompt || undefined },
  });
  if (error || !data || typeof (data as SwapResult).status !== 'string') {
    return { status: 'failed' };
  }
  return data as SwapResult;
}
