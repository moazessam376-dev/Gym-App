// inbody-analyze — the COACH's on-demand, goal-relative AI analysis of a client's InBody
// reading (Phase 12b, iteration 2). Coach-only by RLS and by the explicit check here.
// It assembles the reading + its extras + the client's goal (athlete_profile) + their
// verified baseline→latest trend, asks the provider for a concise coaching analysis, and
// stores it in body_metric_insights — a COACH-ONLY table (its RLS omits the athlete), so
// the analysis never reaches the client; the coach curates a comment for that.
//
// AI cost control (§9): rate-limited per coach via the ai_usage_events ledger
// (kind='inbody_insight'); recorded before the call (fail-closed). Model output is text
// shown only to the coach as decision-support. Generic errors; details server-side (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { analyzeInbodySchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { getVisionProvider } from '../_shared/vision.ts';
import { recordCost } from '../_shared/rate-limit.ts';

const RATE_LIMIT = 30; // per-coach hourly cap for analysis re-runs (§9)
const WINDOW_MS = 60 * 60 * 1000;

const kg = (g: number | null) => (g == null ? null : Math.round(g / 100) / 10);
const pct = (bp: number | null) => (bp == null ? null : Math.round(bp / 10) / 10);
const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—');

type Metric = {
  user_id: string;
  measured_at: string;
  weight_grams: number;
  body_fat_bp: number | null;
  skeletal_muscle_mass_grams: number | null;
  visceral_fat_level: number | null;
  bmr_kcal: number | null;
  extras: unknown;
};

function buildPrompt(metric: Metric, goal: { primary_goal?: string | null; target_weight_grams?: number | null } | null, history: Metric[]): string {
  const lines: string[] = [];
  lines.push(
    'You are assisting a fitness COACH (not the client). Write a short, practical analysis of this InBody reading for the coach.',
    'Base everything ONLY on the data below — do not invent or assume numbers. This is coaching decision-support, not medical advice.',
    '',
    `Client goal: ${goal?.primary_goal ?? 'not set'}${goal?.target_weight_grams ? `; target weight ${kg(goal.target_weight_grams)} kg` : ''}.`,
    '',
    `This reading (${day(metric.measured_at)}):`,
    `- Weight: ${kg(metric.weight_grams)} kg`,
  );
  if (metric.body_fat_bp != null) lines.push(`- Body fat: ${pct(metric.body_fat_bp)} %`);
  if (metric.skeletal_muscle_mass_grams != null) lines.push(`- Skeletal muscle mass: ${kg(metric.skeletal_muscle_mass_grams)} kg`);
  if (metric.visceral_fat_level != null) lines.push(`- Visceral fat level: ${metric.visceral_fat_level}`);
  if (metric.bmr_kcal != null) lines.push(`- BMR: ${metric.bmr_kcal} kcal`);
  // Extras (segmental, water ratios, score, on-sheet history) — pass through as JSON so
  // the model can use whatever is present without us enumerating every InBody variant.
  if (metric.extras && typeof metric.extras === 'object' && Object.keys(metric.extras as object).length > 0) {
    lines.push(`- Additional data: ${JSON.stringify(metric.extras)}`);
  }

  // Trend from VERIFIED readings only (excludes this one if it's still unverified).
  if (history.length >= 2) {
    const base = history[0];
    const latest = history[history.length - 1];
    lines.push(
      '',
      `Verified trend (${day(base.measured_at)} → ${day(latest.measured_at)}):`,
      `- Weight: ${kg(base.weight_grams)} → ${kg(latest.weight_grams)} kg`,
      `- Body fat: ${pct(base.body_fat_bp)} → ${pct(latest.body_fat_bp)} %`,
      `- Muscle: ${kg(base.skeletal_muscle_mass_grams)} → ${kg(latest.skeletal_muscle_mass_grams)} kg`,
    );
  } else {
    lines.push('', 'Trend: only one verified reading so far — no trend yet.');
  }

  lines.push(
    '',
    'Write 3–5 concise bullet points covering: progress relative to the goal, what is working, what to adjust (training/nutrition), and any notable signal (e.g. left/right segmental asymmetry, a high ECW:TBW ratio). Be specific and actionable. No preamble, no disclaimer.',
  );
  return lines.join('\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await getCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const parsed = analyzeInbodySchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);
  const { metric_id } = parsed.data;

  const svc = serviceClient();

  try {
    const { data: metric } = await svc
      .from('body_metrics')
      .select('user_id, measured_at, weight_grams, body_fat_bp, skeletal_muscle_mass_grams, visceral_fat_level, bmr_kcal, extras')
      .eq('id', metric_id)
      .maybeSingle();
    if (!metric) return json({ error: 'invalid_request' }, 400);

    // Coach-only: the caller must coach the reading's owner (or be an admin).
    const [{ data: owner }, { data: callerProfile }] = await Promise.all([
      svc.from('profiles').select('coach_id').eq('id', metric.user_id).maybeSingle(),
      svc.from('profiles').select('role').eq('id', caller.id).maybeSingle(),
    ]);
    const isCoach = owner?.coach_id != null && owner.coach_id === caller.id;
    const isAdmin = callerProfile?.role === 'admin';
    if (!isCoach && !isAdmin) return json({ error: 'forbidden' }, 403);

    // Per-coach hourly cap on analysis runs (§9).
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await svc
      .from('ai_usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', caller.id)
      .eq('kind', 'inbody_insight')
      .gte('created_at', since);
    if ((count ?? 0) >= RATE_LIMIT) return json({ status: 'rate_limited' }, 200);

    const provider = getVisionProvider();
    const { data: usageRow } = await svc
      .from('ai_usage_events')
      .insert({ user_id: caller.id, kind: 'inbody_insight', provider: provider.name })
      .select('id')
      .single();
    const usageId = (usageRow as { id: string } | null)?.id ?? null;

    // Goal + verified trend for context.
    const [{ data: goal }, { data: verified }] = await Promise.all([
      svc.from('athlete_profile').select('primary_goal, target_weight_grams').eq('user_id', metric.user_id).maybeSingle(),
      svc
        .from('body_metrics')
        .select('user_id, measured_at, weight_grams, body_fat_bp, skeletal_muscle_mass_grams, visceral_fat_level, bmr_kcal, extras')
        .eq('user_id', metric.user_id)
        .not('verified_at', 'is', null)
        .order('measured_at', { ascending: true }),
    ]);

    let analysis: string;
    try {
      analysis = await provider.analyze(buildPrompt(metric as Metric, goal, (verified ?? []) as Metric[]));
    } catch (e) {
      console.error('inbody-analyze model failed', { message: String(e) });
      return json({ status: 'failed' }, 200);
    }
    await recordCost(svc, usageId, provider.lastUsage());
    if (!analysis) return json({ status: 'failed' }, 200);

    // Store as the coach-only insight (one per reading; re-running replaces it).
    const { error: uErr } = await svc.from('body_metric_insights').upsert(
      { metric_id, analysis, provider: provider.name, created_by: caller.id, updated_at: new Date().toISOString() },
      { onConflict: 'metric_id' },
    );
    if (uErr) {
      console.error('inbody-analyze store failed', { message: uErr.message });
      return json({ status: 'failed' }, 200);
    }

    return json({ status: 'analyzed', analysis }, 200);
  } catch (e) {
    console.error('inbody-analyze error', { message: String(e) });
    return json({ error: 'server_error' }, 500);
  }
});
