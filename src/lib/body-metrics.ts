// Data layer for body-composition metrics (migration 0026). The anti-cheat pillar
// (foundations §4): the numbers that drive ranks are COACH-VERIFIED — a coach enters
// them for their client (RLS allows coach/admin writes only; the athlete never
// self-writes), and the DB trigger stamps the verifier. Integer units throughout
// (grams, basis points). The per-coach leaderboard goes through the SECURITY DEFINER
// `coach_body_metrics_board` RPC, never a client-side cross-tenant aggregate.
import { supabase } from './supabase';
import {
  createBodyMetricSchema,
  confirmBodyMetricSchema,
  metricCommentSchema,
  type CreateBodyMetric,
  type ConfirmBodyMetric,
} from '../schemas/body-metric';
import type { AthleteGoal } from '../schemas/athlete-profile';

export type BodyMetricSource = 'coach_entered' | 'inbody_ocr' | 'device' | 'self_reported';

// Per-limb readings off the InBody sheet (kg). All optional — sheets vary.
export type Segment = {
  right_arm_kg?: number | null;
  left_arm_kg?: number | null;
  trunk_kg?: number | null;
  right_leg_kg?: number | null;
  left_leg_kg?: number | null;
};

// Richer OCR capture stored on the reading (Phase 12b). All optional/lenient — the model
// fills what's printed; the coach uses it as context. Never drives ranks.
export type BodyMetricExtras = {
  inbody_score?: number | null;
  fat_free_mass_kg?: number | null;
  total_body_water_kg?: number | null;
  intracellular_water_kg?: number | null;
  extracellular_water_kg?: number | null;
  ecw_tbw_ratio?: number | null;
  phase_angle_deg?: number | null;
  protein_kg?: number | null;
  minerals_kg?: number | null;
  segmental_lean_kg?: Segment | null;
  segmental_fat_kg?: Segment | null;
  target_weight_kg?: number | null;
  weight_control_kg?: number | null;
  fat_control_kg?: number | null;
  muscle_control_kg?: number | null;
  history?: Array<{
    measured_on?: string | null;
    weight_kg?: number | null;
    skeletal_muscle_mass_kg?: number | null;
    body_fat_pct?: number | null;
  }> | null;
  notes?: string | null;
} | null;

export type BodyMetric = {
  id: string;
  user_id: string;
  measured_at: string; // UTC ISO
  weight_grams: number;
  body_fat_bp: number | null;
  skeletal_muscle_mass_grams: number | null;
  body_fat_mass_grams: number | null;
  visceral_fat_level: number | null;
  bmr_kcal: number | null;
  source: BodyMetricSource;
  verified_at: string | null;
  verified_by: string | null;
  media_id: string | null;
  note: string | null;
  extras: BodyMetricExtras;
};

const COLS =
  'id, user_id, measured_at, weight_grams, body_fat_bp, skeletal_muscle_mass_grams, body_fat_mass_grams, visceral_fat_level, bmr_kcal, source, verified_at, verified_by, media_id, note, extras';

/**
 * Verified body metrics for `userId`, oldest→newest (chart-friendly). RLS limits
 * results to the owner / their coach / admin. Only verified rows are returned —
 * unverified data must never frame progress or ranks.
 */
export async function listBodyMetrics(userId: string): Promise<BodyMetric[]> {
  const { data, error } = await supabase
    .from('body_metrics')
    .select(COLS)
    .eq('user_id', userId)
    .not('verified_at', 'is', null)
    .order('measured_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as BodyMetric[];
}

/**
 * UNVERIFIED OCR readings for `userId`, newest first — the coach's review queue
 * (Phase 12b). These are staged by the inbody-ocr Edge Function (source='inbody_ocr')
 * and stay out of ranks/progress until the coach confirms one. RLS limits results to
 * the owner / their coach / admin.
 */
export async function listUnverifiedOcrMetrics(userId: string): Promise<BodyMetric[]> {
  const { data, error } = await supabase
    .from('body_metrics')
    .select(COLS)
    .eq('user_id', userId)
    .eq('source', 'inbody_ocr')
    .is('verified_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BodyMetric[];
}

export type MediaMetricLink = {
  media_id: string;
  metric_id: string;
  verified: boolean;
  source: BodyMetricSource;
};

/**
 * For each of `userId`'s metric rows that links a scan, a compact {media_id → status}
 * record — lets the InBody scans screen show per-scan OCR state (awaiting coach /
 * confirmed) without pulling every full reading. RLS-scoped (owner / coach / admin).
 */
export async function listMetricLinksFor(userId: string): Promise<MediaMetricLink[]> {
  const { data, error } = await supabase
    .from('body_metrics')
    .select('id, media_id, verified_at, source')
    .eq('user_id', userId)
    .not('media_id', 'is', null);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    media_id: r.media_id as string,
    metric_id: r.id as string,
    verified: r.verified_at != null,
    source: r.source as BodyMetricSource,
  }));
}

/** A single metric row by id (RLS-scoped) — used to prefill the coach's confirm screen. */
export async function getBodyMetric(id: string): Promise<BodyMetric | null> {
  const { data, error } = await supabase.from('body_metrics').select(COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as BodyMetric) ?? null;
}

/**
 * Coach enters a verified metric for their client. `source` is fixed to
 * 'coach_entered'; the verifier + timestamp are server-stamped by the trigger.
 * RLS rejects this for anyone who isn't the client's coach (or an admin).
 */
export async function addBodyMetric(clientId: string, input: CreateBodyMetric): Promise<BodyMetric> {
  const v = createBodyMetricSchema.parse(input);
  const { data, error } = await supabase
    .from('body_metrics')
    .insert({
      user_id: clientId,
      source: 'coach_entered',
      weight_grams: v.weight_grams,
      body_fat_bp: v.body_fat_bp ?? null,
      skeletal_muscle_mass_grams: v.skeletal_muscle_mass_grams ?? null,
      body_fat_mass_grams: v.body_fat_mass_grams ?? null,
      visceral_fat_level: v.visceral_fat_level ?? null,
      bmr_kcal: v.bmr_kcal ?? null,
      media_id: v.media_id ?? null,
      note: v.note ?? null,
      ...(v.measured_at ? { measured_at: v.measured_at } : null),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return data as BodyMetric;
}

/** Remove a mistaken entry (coach of the client / admin only, per RLS). */
export async function deleteBodyMetric(id: string): Promise<void> {
  const { error } = await supabase.from('body_metrics').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Coach confirms an OCR-staged reading (Phase 12b): writes the (possibly corrected)
 * numbers and flips `source` → 'coach_entered'. That flip makes the 0026 verification
 * trigger stamp `verified_by = auth.uid()` + `verified_at = now()` — so the reading
 * becomes verified and starts feeding ranks/progress. RLS rejects this for anyone who
 * isn't the client's coach (or admin); an athlete cannot confirm their own row.
 */
export async function confirmOcrMetric(id: string, input: ConfirmBodyMetric): Promise<void> {
  const v = confirmBodyMetricSchema.parse(input);
  const { error } = await supabase
    .from('body_metrics')
    .update({
      source: 'coach_entered',
      weight_grams: v.weight_grams,
      body_fat_bp: v.body_fat_bp ?? null,
      skeletal_muscle_mass_grams: v.skeletal_muscle_mass_grams ?? null,
      body_fat_mass_grams: v.body_fat_mass_grams ?? null,
      visceral_fat_level: v.visceral_fat_level ?? null,
      bmr_kcal: v.bmr_kcal ?? null,
      note: v.note ?? null,
      ...(v.measured_at ? { measured_at: v.measured_at } : null),
    })
    .eq('id', id);
  if (error) throw error;
}

// ── Coach-only AI insight (Phase 12b) ───────────────────────────────────────

export type MetricInsight = {
  metric_id: string;
  analysis: string;
  provider: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * The coach-only AI analysis for a reading, if one was generated. RLS limits this table
 * to the metric's coach/admin — an athlete reading it gets nothing (the analysis is the
 * coach's private decision-support; the client sees the coach's comment instead).
 */
export async function getMetricInsight(metricId: string): Promise<MetricInsight | null> {
  const { data, error } = await supabase
    .from('body_metric_insights')
    .select('metric_id, analysis, provider, created_at, updated_at')
    .eq('metric_id', metricId)
    .maybeSingle();
  if (error) throw error;
  return (data as MetricInsight) ?? null;
}

// ── Coach → client comments on a reading (Phase 12b) ────────────────────────

export type MetricComment = {
  id: string;
  metric_id: string;
  author_id: string;
  body: string;
  created_at: string;
};

const COMMENT_COLS = 'id, metric_id, author_id, body, created_at';

/** Comments on one reading, oldest→newest. RLS: owner / coach / admin. */
export async function listMetricComments(metricId: string): Promise<MetricComment[]> {
  const { data, error } = await supabase
    .from('body_metric_comments')
    .select(COMMENT_COLS)
    .eq('metric_id', metricId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MetricComment[];
}

/** Comments across several readings in one query (for the athlete's inline per-scan view). */
export async function listCommentsForMetrics(metricIds: string[]): Promise<MetricComment[]> {
  if (metricIds.length === 0) return [];
  const { data, error } = await supabase
    .from('body_metric_comments')
    .select(COMMENT_COLS)
    .in('metric_id', metricIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MetricComment[];
}

/** Coach posts a comment on a client's reading. author_id is server-set; RLS rejects
 *  anyone who isn't the reading's coach (or admin). */
export async function addMetricComment(metricId: string, body: string): Promise<MetricComment> {
  const v = metricCommentSchema.parse({ body });
  const { data, error } = await supabase
    .from('body_metric_comments')
    .insert({ metric_id: metricId, body: v.body })
    .select(COMMENT_COLS)
    .single();
  if (error) throw error;
  return data as MetricComment;
}

/** Remove a comment (the author / admin only, per RLS). */
export async function deleteMetricComment(id: string): Promise<void> {
  const { error } = await supabase.from('body_metric_comments').delete().eq('id', id);
  if (error) throw error;
}

// ── Per-coach leaderboard (goal-relative) ───────────────────────────────────

export type BoardRow = {
  client_id: string;
  full_name: string | null;
  primary_goal: AthleteGoal | null;
  target_weight_grams: number | null;
  entries: number;
  baseline_at: string | null;
  baseline_weight_grams: number | null;
  baseline_body_fat_bp: number | null;
  baseline_smm_grams: number | null;
  latest_at: string | null;
  latest_weight_grams: number | null;
  latest_body_fat_bp: number | null;
  latest_smm_grams: number | null;
};

/** The caller-coach's cohort (server-fenced; verified rows only). */
export async function getBodyMetricsBoard(): Promise<BoardRow[]> {
  const { data, error } = await supabase.rpc('coach_body_metrics_board');
  if (error) throw error;
  return (data ?? []) as BoardRow[];
}

export type GoalProgress = {
  // "Progress points" on a roughly human-comparable single-digit scale (1 point ≈
  // one body-fat percent lost OR one kg of muscle gained), so a cutter and a bulker
  // aren't ranked by raw-unit scale. Higher = better. A heuristic, not a normalized
  // index — but the headline states exactly what earned the rank, so it's honest.
  score: number;
  headline: string;
  // false = not yet rankable: only one reading, OR the goal's metric wasn't measured
  // in both readings (e.g. a fat-loss client with no body-fat numbers).
  hasTrend: boolean;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Goal-relative progress from a board row. Each athlete is scored on the change that
 * matters for THEIR goal (fat loss vs muscle gain vs recomp), in comparable "points".
 */
export function goalProgress(r: BoardRow): GoalProgress {
  const twoReadings = r.entries > 1 && r.baseline_at != null && r.latest_at != null && r.baseline_at !== r.latest_at;
  if (!twoReadings) return { score: 0, headline: 'First reading logged', hasTrend: false };

  // Only count a metric when it's present in BOTH readings (else the delta is fake).
  const fatMeasured = r.baseline_body_fat_bp != null && r.latest_body_fat_bp != null;
  const smmMeasured = r.baseline_smm_grams != null && r.latest_smm_grams != null;
  const fatPct = fatMeasured ? round1((r.baseline_body_fat_bp! - r.latest_body_fat_bp!) / 100) : null; // + = lost
  const muscleKg = smmMeasured ? round1((r.latest_smm_grams! - r.baseline_smm_grams!) / 1000) : null; // + = gained

  const fatHeadline = fatPct == null ? null : `${fatPct >= 0 ? '−' : '+'}${Math.abs(fatPct)}% body fat`;
  const muscleHeadline = muscleKg == null ? null : `${muscleKg >= 0 ? '+' : '−'}${Math.abs(muscleKg)} kg muscle`;
  const needsReading = (what: string): GoalProgress => ({ score: 0, headline: `Needs ${what}`, hasTrend: false });

  switch (r.primary_goal) {
    case 'lose_fat':
      return fatPct == null ? needsReading('a body-fat reading') : { score: fatPct, headline: fatHeadline!, hasTrend: true };
    case 'build_muscle':
    case 'gain_strength':
      return muscleKg == null ? needsReading('a muscle reading') : { score: muscleKg, headline: muscleHeadline!, hasTrend: true };
    default: {
      // maintain / improve_health / sport_performance / null → recomposition: reward
      // both fat loss and muscle gain. Need at least one of the two measured.
      if (fatPct == null && muscleKg == null) return needsReading('a body-fat or muscle reading');
      return {
        score: (fatPct ?? 0) + (muscleKg ?? 0),
        headline: [fatHeadline, muscleHeadline].filter(Boolean).join(' · '),
        hasTrend: true,
      };
    }
  }
}

/** Rank a board by goal-relative progress, best first (trendless rows sink last). */
export function rankBoard(rows: BoardRow[]): (BoardRow & { progress: GoalProgress; rank: number })[] {
  return rows
    .map((r) => ({ ...r, progress: goalProgress(r) }))
    .sort((a, b) => Number(b.progress.hasTrend) - Number(a.progress.hasTrend) || b.progress.score - a.progress.score)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
