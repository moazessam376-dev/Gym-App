// Data layer for body-weight progress entries (migration 0002 `progress_entries`).
// A CLIENT owns their entries (the RLS insert check forces `user_id = auth.uid()`);
// their coach + admin can READ them (progress_entries_select). Weight is stored as
// INTEGER grams (foundations §3) — the UI converts kg/lb display ↔ grams via
// src/lib/units.ts. Inputs are Zod-validated and allowlisted (never spread input).
import { supabase } from './supabase';
import { createWeightSchema, type CreateWeight } from '../schemas/progress';

export type WeightEntry = {
  id: string;
  user_id: string;
  recorded_at: string; // UTC ISO
  weight_grams: number;
  note: string | null;
};

const COLS = 'id, user_id, recorded_at, weight_grams, note';

/**
 * Weight entries for `userId`, oldest→newest (chart-friendly order). Only rows that
 * actually carry a weight (the table also backs other progress notes). RLS limits
 * results to what the caller may read (own / their coach's clients / admin).
 */
export async function listProgressWeights(userId: string): Promise<WeightEntry[]> {
  const { data, error } = await supabase
    .from('progress_entries')
    .select(COLS)
    .eq('user_id', userId)
    .not('weight_grams', 'is', null)
    .order('recorded_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as WeightEntry[];
}

/** Log a new weight entry for the owner. `user_id` is forced from the verified caller. */
export async function addWeightEntry(userId: string, input: CreateWeight): Promise<WeightEntry> {
  const v = createWeightSchema.parse(input);
  const { data, error } = await supabase
    .from('progress_entries')
    .insert({
      user_id: userId,
      weight_grams: v.weight_grams,
      note: v.note ?? null,
      ...(v.recorded_at ? { recorded_at: v.recorded_at } : null),
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return data as WeightEntry;
}

/** Delete one of the owner's weight entries (RLS delete = owner only). */
export async function deleteWeightEntry(entryId: string): Promise<void> {
  const { error } = await supabase.from('progress_entries').delete().eq('id', entryId);
  if (error) throw error;
}
