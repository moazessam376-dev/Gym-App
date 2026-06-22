// Zod contract for body-weight progress entries (migration 0002 `progress_entries`),
// per CLAUDE.md §4 / foundations §2. Allowlist only: `user_id` is server-set (the
// RLS insert check forces `user_id = auth.uid()`), never accepted from the client.
// Weight is an INTEGER number of grams (foundations §3) — never a float kg/lb.
import { z } from 'zod';

// A sane upper bound (650 kg) guards against fat-finger / unit-confusion inserts.
const MAX_WEIGHT_GRAMS = 650_000;

export const createWeightSchema = z.object({
  // Canonical integer grams. The UI converts the athlete's display unit (kg/lb)
  // → grams via src/lib/units.ts before validating.
  weight_grams: z.number().int().positive().max(MAX_WEIGHT_GRAMS),
  note: z.string().max(500).nullable().optional(),
  // Optional explicit timestamp (UTC ISO). Defaults to now() server-side.
  recorded_at: z.string().datetime().optional(),
});
export type CreateWeight = z.infer<typeof createWeightSchema>;
