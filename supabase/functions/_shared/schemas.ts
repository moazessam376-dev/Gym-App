// Server-side Zod contracts for the assignment Edge Functions (§4). The app
// validates the same shapes before calling (src/schemas/invitation.ts), but the
// server NEVER trusts the client and re-validates here. Allowlist fields only —
// no req.body spread.
import { z } from 'zod';

export const acceptInvitationSchema = z.object({
  token: z.string().uuid(),
});

export const assignClientSchema = z.object({
  client_id: z.string().uuid(),
});

export const reviewApplicationSchema = z.object({
  application_id: z.string().uuid(),
  approve: z.boolean(),
});

// ── Chat safety moderation (Phase 18, §8) ───────────────────────────────────
// Admin resolves a message report: dismiss (no action), ban (block the reported
// user from sending), or unban. Server re-validates; only an admin may call it.
export const moderateReportSchema = z.object({
  report_id: z.string().uuid(),
  decision: z.enum(['dismiss', 'ban', 'unban']),
});

// Admin resolves a banned user's appeal: approve (lift the ban) or reject (keep it).
// Server re-validates; only an admin may call it.
export const resolveAppealSchema = z.object({
  appeal_id: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});

// ── Coach request resolution (Slice G2) ─────────────────────────────────────
// A coach accepts (links the client) or declines a request addressed to them.
// resolve_coach_request is the only writer of accept/decline + the coach link.
export const resolveCoachRequestSchema = z.object({
  request_id: z.string().uuid(),
  decision: z.enum(['accept', 'decline']),
});

// ── Admin ban/unban from user search (Slice G3) ─────────────────────────────
// Sets profiles.banned_at directly (client-immutable, service-role only). The Edge
// Function re-checks the caller is an admin before applying.
export const adminSetBanSchema = z.object({
  user_id: z.string().uuid(),
  banned: z.boolean(),
});

// ── Native push fan-out (Phase 17 Slice 2, §3/§8) ───────────────────────────
// push-send is invoked ONLY by the notifications AFTER INSERT trigger (0041) via
// pg_net, carrying the service-role key as its bearer. The payload is just the id
// of the freshly-inserted feed row; the function loads everything else server-side.
export const pushSendSchema = z.object({
  notification_id: z.string().uuid(),
});

// ── Media uploads (Phase 4, §7) ─────────────────────────────────────────────
// The allowlist is enforced here AND by magic-byte detection in media-finalize.
// Audio (voice notes, Phase 18): expo-audio records AAC-in-MP4 (.m4a → audio/mp4);
// mp3/wav accepted defensively. Bytes are validated by magic bytes server-side.
// avatar (Phase 19): profile photos reuse the exact same JPEG pipeline as progress photos.
export const MEDIA_MIME_TYPES = [
  'image/jpeg', 'image/png', 'application/pdf',
  'audio/mp4', 'audio/mpeg', 'audio/wav',
] as const;
export const MEDIA_KINDS = ['progress_photo', 'inbody', 'other', 'audio', 'avatar'] as const;
const MEDIA_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (§7)

// Request a signed upload URL into the locked inbox. No media row yet.
export const createUploadSchema = z.object({
  mime_type: z.enum(MEDIA_MIME_TYPES),
  size_bytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
});

// Finalize: the inbox_path must be `{ownerUuid}/{uuid}.{ext}` (no traversal); the
// function re-checks the owner segment against the verified caller.
export const finalizeSchema = z.object({
  inbox_path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|pdf|m4a|mp3|wav)$/i),
  kind: z.enum(MEDIA_KINDS),
  progress_entry_id: z.string().uuid().optional(),
});

export const signedUrlSchema = z.object({
  media_id: z.string().uuid(),
});

// ── InBody OCR (Phase 12b, §9) ──────────────────────────────────────────────
// The athlete asks the server to read an already-uploaded InBody scan (a `media`
// row of kind 'inbody'). The function re-checks ownership/kind against the verified
// caller; nothing here is trusted beyond the shape.
export const inbodyOcrSchema = z.object({
  media_id: z.string().uuid(),
});

// Coach asks for the on-demand, goal-relative AI analysis of a reading (coach-only).
export const analyzeInbodySchema = z.object({
  metric_id: z.string().uuid(),
});

// ── Coach AI: plan generation, nudges, utility (Phase 13, §9) ───────────────
// All coach-only. The optional `coach_prompt` is a short steering instruction the
// coach can type; it is UNTRUSTED free text — the prompt guards against injection
// and every model output is Zod-validated below before any DB write. Library ids
// the model returns are resolved against the coach-readable library server-side, so
// the model can never invent an id or smuggle macros (the snapshot is copied from
// the real row). The lenient UUID matches src/schemas/plan.ts (seeded global ids
// aren't RFC-4122, so z.string().uuid() would wrongly reject picking a global).
const looseUuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid id');
const coachPrompt = z.string().max(280).optional();

export const coachPlanGenSchema = z.object({
  client_id: z.string().uuid(),
  type: z.enum(['training', 'nutrition']),
  // Pilot generates ONE week (reliable on the free model); the coach extends via the
  // editor's Duplicate-week / Adjust-with-AI. Multi-week returns at launch on Claude.
  coach_prompt: coachPrompt,
});

export const coachPlanNudgeSchema = z.object({
  client_id: z.string().uuid(),
  coach_prompt: coachPrompt,
});

// Adjust an existing DRAFT plan in place (rewrites its contents from a coach prompt).
export const coachPlanAdjustSchema = z.object({
  plan_id: looseUuid,
  coach_prompt: coachPrompt,
});

export const coachFoodMacrosSchema = z.object({
  name: z.string().min(1).max(120),
  coach_prompt: coachPrompt,
});

export const coachExerciseSwapSchema = z.object({
  client_id: z.string().uuid(),
  exercise_id: looseUuid,
  coach_prompt: coachPrompt,
});

// Phase 15: narrate the coach's already-computed roster KPIs. No client_id — it's a
// roster-level summary for the calling coach. The optional prompt only steers framing.
export const coachAnalyticsSummarySchema = z.object({
  coach_prompt: coachPrompt,
});

// ── Model-output contracts (validated before any DB write, §9) ──────────────
// Generation emits ids the server then resolves against the coach-readable library
// (drops unknowns); names/macros are copied from the real library row, never trusted
// from the model. Quantities are integers (foundations §3); bounds mirror plan.ts.
//
// IMPORTANT (free-model tolerance): a free LLM frequently returns a stringified number
// ("4" not 4) or a capitalized enum ("Primary"). A single such field would otherwise
// fail the WHOLE parse and the generation silently returns "failed". So numeric fields
// use z.coerce.number(), `block` is accepted as a loose string (the server normalizes
// it to the training_block enum), bounds are generous, and arrays are forgiving. The
// snapshot/id-resolution still happens server-side, so loosening here changes nothing
// about what gets stored — only how robustly we accept a slightly-off shape.
const planNote = z.string().max(2000).nullish();
// reps is free text ("8-12"); coerce in case the model emits a bare number (10 -> "10").
const reps = z.coerce.string().max(40).nullish();
const intCoerce = (max: number) => z.coerce.number().int().min(0).max(max).nullish();

const genExerciseSchema = z.object({
  exercise_id: looseUuid,
  block: z.coerce.string().max(40).nullish(), // normalized to the enum server-side (default 'primary')
  sets: intCoerce(99),
  reps,
  rest_seconds: intCoerce(3600),
  tempo: z.coerce.string().max(40).nullish(),
  note: planNote,
});
const genDaySchema = z.object({
  name: z.string().min(1).max(120),
  note: planNote,
  exercises: z.array(genExerciseSchema).max(20),
});
const genWeekSchema = z.object({
  name: z.string().min(1).max(120),
  note: planNote,
  days: z.array(genDaySchema).min(1).max(7),
});
export const genTrainingPlanSchema = z.object({
  title: z.string().min(1).max(120),
  weeks: z.array(genWeekSchema).min(1).max(8),
});

// Some models ignore the "weeks" array instruction and return a singular { week: {...} }.
// Normalize that to the array shape BEFORE validating. We do this in a plain helper rather
// than z.preprocess on purpose: a preprocess pipe erases the schema's OUTPUT type (the
// parsed `gen.data` becomes `unknown` under a strict typecheck), which would force `as`
// casts at every call site. A plain z.object keeps `gen.data` correctly typed.
export function normalizeTrainingRaw(v: unknown): unknown {
  if (v && typeof v === 'object' && !('weeks' in v) && 'week' in (v as Record<string, unknown>)) {
    return { ...(v as Record<string, unknown>), weeks: [(v as Record<string, unknown>).week] };
  }
  return v;
}

const genMealItemSchema = z.object({
  food_id: looseUuid,
  grams: z.coerce.number().int().min(0).max(5000),
  note: planNote,
});
const genMealSchema = z.object({
  name: z.string().min(1).max(120),
  note: planNote,
  items: z.array(genMealItemSchema).max(20),
});
export const genNutritionPlanSchema = z.object({
  title: z.string().min(1).max(120),
  meals: z.array(genMealSchema).min(1).max(10),
});

// Macro autofill: per-100g integers, bounds mirror src/schemas/nutrition.ts.
export const genFoodMacrosSchema = z.object({
  kcal_per_100g: z.coerce.number().int().min(0).max(2000),
  protein_g_per_100g: z.coerce.number().int().min(0).max(100),
  carbs_g_per_100g: z.coerce.number().int().min(0).max(100),
  fat_g_per_100g: z.coerce.number().int().min(0).max(100),
});

// Injury-aware swap suggestions: library ids + a short reason each (server resolves ids).
export const genExerciseSwapSchema = z.object({
  suggestions: z
    .array(z.object({ exercise_id: looseUuid, reason: z.string().max(200) }))
    .max(6),
});
