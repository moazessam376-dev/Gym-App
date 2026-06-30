// Coach KPI Analytics data layer (Phase 15). The numbers come from DETERMINISTIC,
// coach-fenced SECURITY DEFINER RPCs (migration 0031) — never a client-side cross-tenant
// aggregate. This module wraps those RPCs and provides the pure SCORING helpers (the
// product choice that turns raw fields into adherence % / goal-progress), reusing the
// existing goalProgress() so a cutter and a bulker are scored against their OWN goal.
// AI is thin and last: requestAnalyticsSummary()/getAnalyticsInsight() wrap a coach-only
// Edge Function that only NARRATES these computed figures (RLS hides the row from clients).
import { supabase } from './supabase';
import { goalProgress, type BoardRow, type GoalProgress } from './body-metrics';
import type { AthleteGoal } from '../schemas/athlete-profile';
import type { PlanType } from '../schemas/plan';

// ── Roster adherence (coach_adherence_overview) ─────────────────────────────

export type AdherenceRow = {
  client_id: string;
  full_name: string | null;
  primary_goal: AthleteGoal | null;
  training_days_target: number | null;
  sessions_completed: number;
  nutrition_days: number;
  last_session_date: string | null; // date (YYYY-MM-DD) | null
};

/** Local YYYY-MM-DD `daysAgo` days back (device-local, no UTC drift) — the RPC window start. */
function sinceLocalDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const ADHERENCE_WINDOW_DAYS = 30;

/** Per-client roster adherence over the trailing window (server-fenced to the caller's clients). */
export async function getAdherenceOverview(windowDays = ADHERENCE_WINDOW_DAYS): Promise<AdherenceRow[]> {
  const { data, error } = await supabase.rpc('coach_adherence_overview', { p_since: sinceLocalDate(windowDays) });
  if (error) throw error;
  return (data ?? []) as AdherenceRow[];
}

// ── Weekly roster-activity trend (coach_performance_trends, E5) ──────────────
export type CoachTrendPoint = {
  week_start: string;
  sessions_logged: number;
  active_clients: number;
};

/** Last N weeks of roster activity (sessions + active clients per week), coach-fenced. */
export async function getCoachPerformanceTrends(weeks = 8): Promise<CoachTrendPoint[]> {
  const { data, error } = await supabase.rpc('coach_performance_trends', { p_weeks: weeks });
  if (error) throw error;
  return (data ?? []) as CoachTrendPoint[];
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export type AdherenceScore = {
  // training % = completed sessions vs (the athlete's own target days/week × weeks in window).
  // null when the athlete hasn't set a training-days target (can't fairly score it).
  trainingPct: number | null;
  nutritionPct: number; // days logged vs days in window
  overallPct: number | null; // mean of the available metrics
};

/** Deterministic adherence scoring from a roster row — the product choice, kept out of SQL. */
export function adherenceScore(row: AdherenceRow, windowDays = ADHERENCE_WINDOW_DAYS): AdherenceScore {
  const weeks = windowDays / 7;
  const expected = (row.training_days_target ?? 0) * weeks;
  const trainingPct = expected > 0 ? clampPct((row.sessions_completed / expected) * 100) : null;
  const nutritionPct = clampPct((row.nutrition_days / windowDays) * 100);
  const overallPct = trainingPct == null ? nutritionPct : Math.round((trainingPct + nutritionPct) / 2);
  return { trainingPct, nutritionPct, overallPct };
}

/** Roster-average adherence % (rounded), or null when there are no clients. */
export function rosterAdherencePct(rows: AdherenceRow[], windowDays = ADHERENCE_WINDOW_DAYS): number | null {
  if (rows.length === 0) return null;
  const sum = rows.reduce((a, r) => a + adherenceScore(r, windowDays).overallPct! , 0);
  return Math.round(sum / rows.length);
}

// ── "Needs attention": clients the coach should look at right now ────────────

export type AttentionReason = 'no_sessions' | 'inactive' | 'low_adherence';
export type AttentionRow = {
  client_id: string;
  full_name: string | null;
  reason: AttentionReason;
  value: number; // 'inactive' → days since last session; 'low_adherence' → the %
};

export const INACTIVE_DAYS = 5;
const LOW_ADHERENCE_PCT = 50;

/** Whole days between a YYYY-MM-DD date and today (device-local), or null. */
function daysSinceLocal(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(`${dateStr}T00:00:00`).getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * Roster rows that need the coach's attention, worst-first: a client with no logged
 * session, one who's gone quiet (≥ INACTIVE_DAYS since their last session), or one
 * below the adherence floor. Powered by absence/lateness so it's populated even when
 * the progress board is empty. Pure — derived from the already-loaded adherence rows.
 */
export function needsAttention(rows: AdherenceRow[], windowDays = ADHERENCE_WINDOW_DAYS): AttentionRow[] {
  const out: AttentionRow[] = [];
  for (const r of rows) {
    if (r.last_session_date == null || r.sessions_completed === 0) {
      out.push({ client_id: r.client_id, full_name: r.full_name, reason: 'no_sessions', value: 0 });
      continue;
    }
    const days = daysSinceLocal(r.last_session_date);
    if (days != null && days >= INACTIVE_DAYS) {
      out.push({ client_id: r.client_id, full_name: r.full_name, reason: 'inactive', value: days });
      continue;
    }
    const pct = adherenceScore(r, windowDays).overallPct;
    if (pct != null && pct < LOW_ADHERENCE_PCT) {
      out.push({ client_id: r.client_id, full_name: r.full_name, reason: 'low_adherence', value: pct });
    }
  }
  const severity = (a: AttentionRow) => (a.reason === 'no_sessions' ? 2 : a.reason === 'inactive' ? 1 : 0);
  return out.sort((a, b) => severity(b) - severity(a) || b.value - a.value);
}

// ── Goals I deliver (derived from the existing board, per-client) ───────────

export type GoalDelivered = { goal: AthleteGoal | null; clients: number; avgScore: number };

const GOAL_LABEL: Record<string, string> = {
  lose_fat: 'Fat loss',
  build_muscle: 'Muscle gain',
  gain_strength: 'Strength',
  maintain: 'Maintain',
  improve_health: 'Health',
  sport_performance: 'Performance',
};
export const goalLabel = (g: AthleteGoal | null): string => (g ? (GOAL_LABEL[g] ?? g) : 'No goal set');

/** Group the ranked board by primary goal → which goals the coach reliably delivers.
 *  Only clients with a real verified trend count; avgScore is the goal-relative progress. */
export function goalsDelivered(board: (BoardRow & { progress: GoalProgress })[]): GoalDelivered[] {
  const groups = new Map<string, { goal: AthleteGoal | null; scores: number[] }>();
  for (const r of board) {
    if (!r.progress.hasTrend) continue;
    const key = r.primary_goal ?? '__none__';
    if (!groups.has(key)) groups.set(key, { goal: r.primary_goal, scores: [] });
    groups.get(key)!.scores.push(r.progress.score);
  }
  return [...groups.values()]
    .map((g) => ({
      goal: g.goal,
      clients: g.scores.length,
      avgScore: Math.round((g.scores.reduce((a, s) => a + s, 0) / g.scores.length) * 10) / 10,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

// ── Plan effectiveness (coach_plan_effectiveness) ───────────────────────────

// Shape-compatible with BoardRow (so goalProgress() scores it) + the plan provenance.
// `plan_type` (not `type`) mirrors the RPC's OUT column name (which avoids the SQL keyword).
export type PlanEffectivenessRow = BoardRow & {
  plan_id: string;
  source_plan_id: string | null;
  title: string;
  plan_type: PlanType;
  ai_generated: boolean;
  plan_created_at: string;
};

/** The caller-coach's published, client-assigned plans + each client's verified trend. */
export async function getPlanEffectiveness(): Promise<PlanEffectivenessRow[]> {
  const { data, error } = await supabase.rpc('coach_plan_effectiveness');
  if (error) throw error;
  return (data ?? []) as PlanEffectivenessRow[];
}

export type TopPlan = {
  key: string;
  title: string;
  plan_type: PlanType;
  ai_generated: boolean;
  clients: number; // assigned plans grouped under this lineage/title
  avgScore: number;
  headline: string; // the best client's goal-relative headline
};

/** Group assigned plans by template lineage (source_plan_id) or title → "plans that work".
 *  Each plan is scored by its client's goal-relative progress (goalProgress); trendless drop. */
export function topPlans(rows: PlanEffectivenessRow[]): TopPlan[] {
  const groups = new Map<string, { row: PlanEffectivenessRow; scores: number[]; best: GoalProgress }>();
  for (const r of rows) {
    const p = goalProgress(r);
    if (!p.hasTrend) continue;
    const key = r.source_plan_id ?? `${r.plan_type}:${r.title}`;
    const g = groups.get(key);
    if (!g) groups.set(key, { row: r, scores: [p.score], best: p });
    else {
      g.scores.push(p.score);
      if (p.score > g.best.score) g.best = p;
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      title: g.row.title,
      plan_type: g.row.plan_type,
      ai_generated: g.row.ai_generated,
      clients: g.scores.length,
      avgScore: Math.round((g.scores.reduce((a, s) => a + s, 0) / g.scores.length) * 10) / 10,
      headline: g.best.headline,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

export type AiVsHuman = { ai: { count: number; avgScore: number | null }; human: { count: number; avgScore: number | null } };

/** Split published plans by provenance (AI-drafted vs hand-built) and average their effect. */
export function aiVsHuman(rows: PlanEffectivenessRow[]): AiVsHuman {
  const bucket = (subset: PlanEffectivenessRow[]) => {
    const scored = subset.map((r) => goalProgress(r)).filter((p) => p.hasTrend);
    return {
      count: subset.length,
      avgScore: scored.length ? Math.round((scored.reduce((a, p) => a + p.score, 0) / scored.length) * 10) / 10 : null,
    };
  };
  return {
    ai: bucket(rows.filter((r) => r.ai_generated)),
    human: bucket(rows.filter((r) => !r.ai_generated)),
  };
}

// ── AI narration (coach-only Edge Function + coach-owned storage) ───────────

export type AnalyticsSummaryStatus = 'analyzed' | 'no_data' | 'rate_limited' | 'failed';
export type AnalyticsSummaryResult = { status: AnalyticsSummaryStatus; analysis?: string };

/** Generate a short, coach-only narration of the roster KPIs. `coachPrompt` steers framing. */
export async function requestAnalyticsSummary(coachPrompt?: string): Promise<AnalyticsSummaryResult> {
  const { data, error } = await supabase.functions.invoke('coach-analytics-summary', {
    body: { coach_prompt: coachPrompt || undefined },
  });
  if (error || !data || typeof (data as AnalyticsSummaryResult).status !== 'string') {
    return { status: 'failed' };
  }
  return data as AnalyticsSummaryResult;
}

/** Read the stored roster summary for the calling coach (RLS limits it to its owner). */
export async function getAnalyticsInsight(): Promise<{ analysis: string; updated_at: string } | null> {
  const { data, error } = await supabase
    .from('coach_analytics_insights')
    .select('analysis, updated_at')
    .maybeSingle();
  if (error) throw error;
  return (data as { analysis: string; updated_at: string }) ?? null;
}
