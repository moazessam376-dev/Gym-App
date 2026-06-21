// Zod contract for athlete food preferences (migration 0020). Athlete-owned:
// user_id is forced server-side (trigger + RLS), never client-supplied. The
// athlete marks a food as 'like' or 'avoid'; their coach reads it (read-only).
import { z } from 'zod';

export const foodPrefKindSchema = z.enum(['like', 'avoid']);
export type FoodPrefKind = z.infer<typeof foodPrefKindSchema>;

export const setFoodPreferenceSchema = z.object({
  food_id: z.string().uuid(),
  kind: foodPrefKindSchema,
});
export type SetFoodPreference = z.infer<typeof setFoodPreferenceSchema>;
