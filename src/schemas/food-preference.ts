// Zod contract for athlete food preferences (migration 0020). Athlete-owned:
// user_id is forced server-side (trigger + RLS), never client-supplied. The
// athlete marks a food as 'like' or 'avoid'; their coach reads it (read-only).
import { z } from 'zod';

// Lenient UUID (matches src/schemas/plan.ts / session.ts): the seeded GLOBAL food
// ids aren't RFC-4122-versioned, so z.string().uuid() wrongly rejects them.
const uuid = z
  .string()
  .regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, 'Invalid id');

export const foodPrefKindSchema = z.enum(['like', 'avoid']);
export type FoodPrefKind = z.infer<typeof foodPrefKindSchema>;

export const setFoodPreferenceSchema = z.object({
  food_id: uuid,
  kind: foodPrefKindSchema,
});
export type SetFoodPreference = z.infer<typeof setFoodPreferenceSchema>;
