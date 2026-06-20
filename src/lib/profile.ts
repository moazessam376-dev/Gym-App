// Profile self-service. A user may edit their OWN profile fields that aren't
// server-controlled — here, full_name. The profiles UPDATE policy (0001) allows
// id = auth.uid(), and the immutability trigger only blocks role/coach_id, so a
// name change needs no special path. Validated with the shared profile schema.
import { supabase } from './supabase';
import { profileSelfInsertSchema } from '../schemas/profile';

/** Update the signed-in user's display name. */
export async function updateMyName(userId: string, fullName: string): Promise<void> {
  const { full_name } = profileSelfInsertSchema.parse({ full_name: fullName.trim() });
  const { error } = await supabase.from('profiles').update({ full_name }).eq('id', userId);
  if (error) throw error;
}

/** The signed-in user's current full_name (null if unset). */
export async function getMyName(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data?.full_name ?? null;
}
