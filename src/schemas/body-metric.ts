// Zod contract for body-composition metrics (migration 0026), per CLAUDE.md §4 /
// foundations §4. Allowlist only. user_id (the athlete) is passed by the data layer;
// source/verified_at/verified_by are server-set (the table default + verification
// trigger) — never accepted from the client. Integer units only (foundations §3):
// weight/muscle as grams, body-fat as basis points (1850 = 18.50%).
import { z } from 'zod';

// Lenient uuid (matches plan.ts/nutrition.ts) — never z.string().uuid(), which
// rejects seeded non-RFC-4122 ids (the canonical gotcha).
const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid id');

// 650 kg / 100% / 500 kg muscle guard against fat-finger entries.
export const createBodyMetricSchema = z.object({
  weight_grams: z.number().int().positive().max(650_000),
  body_fat_bp: z.number().int().min(0).max(10_000).nullable().optional(),
  skeletal_muscle_mass_grams: z.number().int().positive().max(500_000).nullable().optional(),
  body_fat_mass_grams: z.number().int().min(0).max(500_000).nullable().optional(),
  visceral_fat_level: z.number().int().min(0).max(60).nullable().optional(),
  bmr_kcal: z.number().int().positive().max(10_000).nullable().optional(),
  // The InBody test date (UTC ISO). Defaults to now() server-side.
  measured_at: z.string().datetime().optional(),
  // Optional link to the source InBody scan (a media row, uploaded by the athlete).
  media_id: uuid.nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
export type CreateBodyMetric = z.infer<typeof createBodyMetricSchema>;
