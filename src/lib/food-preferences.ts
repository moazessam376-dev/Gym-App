// Data layer for athlete food preferences (migration 0020). The athlete owns their
// own likes/avoids (user_id forced from auth.uid()); their coach reads them via RLS
// (is_coach_of) to personalise plan-building. No cross-tenant function needed — a
// coach's plain SELECT returns exactly their own clients' rows.
import { supabase } from './supabase';
import { setFoodPreferenceSchema, type FoodPrefKind } from '../schemas/food-preference';

export type FoodPreference = {
  user_id: string;
  food_id: string;
  kind: FoodPrefKind;
};

const COLS = 'user_id, food_id, kind';

/** The signed-in athlete's own preferences, keyed by food_id for quick lookup. */
export async function getMyFoodPreferences(userId: string): Promise<Map<string, FoodPrefKind>> {
  const { data, error } = await supabase
    .from('food_preferences')
    .select(COLS)
    .eq('user_id', userId);
  if (error) throw error;
  const map = new Map<string, FoodPrefKind>();
  for (const row of (data ?? []) as FoodPreference[]) map.set(row.food_id, row.kind);
  return map;
}

/** Set (or change) the athlete's stance on a food. Upsert on (user_id, food_id). */
export async function setFoodPreference(
  userId: string,
  foodId: string,
  kind: FoodPrefKind,
): Promise<void> {
  const v = setFoodPreferenceSchema.parse({ food_id: foodId, kind });
  const { error } = await supabase
    .from('food_preferences')
    .upsert({ user_id: userId, food_id: v.food_id, kind: v.kind }, { onConflict: 'user_id,food_id' });
  if (error) throw error;
}

/** Clear the athlete's stance on a food (neither like nor avoid). */
export async function removeFoodPreference(userId: string, foodId: string): Promise<void> {
  const { error } = await supabase
    .from('food_preferences')
    .delete()
    .eq('user_id', userId)
    .eq('food_id', foodId);
  if (error) throw error;
}

/**
 * Every preference across the calling COACH's clients (RLS returns only their
 * clients' rows). Used by the food picker to show which clients like/avoid a food.
 */
export async function listClientFoodPreferences(): Promise<FoodPreference[]> {
  const { data, error } = await supabase.from('food_preferences').select(COLS);
  if (error) throw error;
  return (data ?? []) as FoodPreference[];
}
