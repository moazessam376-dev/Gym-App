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

// ── Media uploads (Phase 4, §7) ─────────────────────────────────────────────
// The allowlist is enforced here AND by magic-byte detection in media-finalize.
export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export const MEDIA_KINDS = ['progress_photo', 'inbody', 'other'] as const;
const MEDIA_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (§7)

// Request a signed upload URL into the locked inbox. No media row yet.
export const createUploadSchema = z.object({
  mime_type: z.enum(MEDIA_MIME_TYPES),
  size_bytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
});

// Finalize: the inbox_path must be `{ownerUuid}/{uuid}.{ext}` (no traversal); the
// function re-checks the owner segment against the verified caller.
export const finalizeSchema = z.object({
  inbox_path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|pdf)$/i),
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
  weeks: z.number().int().min(1).max(4).optional(), // training only; default 1
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

// ── Model-output contracts (validated before any DB write, §9) ──────────────
// Generation emits ids the server then resolves against the coach-readable library
// (drops unknowns); names/macros are copied from the real library row, never trusted
// from the model. Quantities are integers (foundations §3); bounds mirror plan.ts.
const planNote = z.string().max(2000).nullish();
const reps = z.string().max(40).nullish();

const genExerciseSchema = z.object({
  exercise_id: looseUuid,
  block: z.enum(['warmup', 'primary', 'accessory', 'conditioning', 'cooldown']).optional(),
  sets: z.number().int().min(0).max(99).nullish(),
  reps,
  rest_seconds: z.number().int().min(0).max(3600).nullish(),
  tempo: z.string().max(40).nullish(),
  note: planNote,
});
const genDaySchema = z.object({
  name: z.string().min(1).max(120),
  note: planNote,
  exercises: z.array(genExerciseSchema).max(12),
});
const genWeekSchema = z.object({
  name: z.string().min(1).max(120),
  note: planNote,
  days: z.array(genDaySchema).min(1).max(7),
});
export const genTrainingPlanSchema = z.object({
  title: z.string().min(1).max(120),
  weeks: z.array(genWeekSchema).min(1).max(4),
});

const genMealItemSchema = z.object({
  food_id: looseUuid,
  grams: z.number().int().min(0).max(5000),
  note: planNote,
});
const genMealSchema = z.object({
  name: z.string().min(1).max(120),
  note: planNote,
  items: z.array(genMealItemSchema).max(15),
});
export const genNutritionPlanSchema = z.object({
  title: z.string().min(1).max(120),
  meals: z.array(genMealSchema).min(1).max(8),
});

// Macro autofill: per-100g integers, bounds mirror src/schemas/nutrition.ts.
export const genFoodMacrosSchema = z.object({
  kcal_per_100g: z.number().int().min(0).max(2000),
  protein_g_per_100g: z.number().int().min(0).max(100),
  carbs_g_per_100g: z.number().int().min(0).max(100),
  fat_g_per_100g: z.number().int().min(0).max(100),
});

// Injury-aware swap suggestions: library ids + a short reason each (server resolves ids).
export const genExerciseSwapSchema = z.object({
  suggestions: z
    .array(z.object({ exercise_id: looseUuid, reason: z.string().max(200) }))
    .max(6),
});
