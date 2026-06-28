// Profile self-service. A user may edit their OWN profile fields that aren't
// server-controlled — here, full_name. The profiles UPDATE policy (0001) allows
// id = auth.uid(), and the immutability trigger only blocks role/coach_id, so a
// name change needs no special path. Validated with the shared profile schema.
import { supabase } from './supabase';
import { profileSelfInsertSchema, handleSchema } from '../schemas/profile';

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

/** The signed-in user's current @handle (null if unset). */
export async function getMyHandle(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('handle')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.handle as string | null) ?? null;
}

export type HandleCheck = { available: boolean; reason: string | null };

/** Live availability check for a candidate handle (server-side allowlist + uniqueness). */
export async function checkHandleAvailable(handle: string): Promise<HandleCheck> {
  const { data, error } = await supabase.rpc('check_handle_available', {
    p_handle: handle.trim().toLowerCase(),
  });
  if (error) throw error;
  const row = (data ?? [])[0] as HandleCheck | undefined;
  return row ?? { available: false, reason: 'invalid' };
}

/**
 * Set the signed-in user's @handle. Format is validated client-side; uniqueness, the
 * reserved-word blocklist and the 14-day rename cooldown are enforced server-side (0069),
 * so a violation surfaces as a thrown error the caller maps to a generic message.
 */
export async function updateMyHandle(userId: string, handle: string): Promise<void> {
  const h = handleSchema.parse(handle.trim().toLowerCase());
  const { error } = await supabase.from('profiles').update({ handle: h }).eq('id', userId);
  if (error) throw error;
}

/** The signed-in user's current avatar media id (null if none set) — Phase 19. */
export async function getMyAvatarMediaId(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('avatar_media_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.avatar_media_id as string | null) ?? null;
}

/**
 * Point the user's avatar at one of their OWN `avatar`-kind media rows (Phase 19).
 * The DB trigger (0044) rejects a media id that isn't the caller's own avatar, so an
 * impersonation attempt fails server-side regardless of the client. Pass null to clear.
 */
export async function setMyAvatar(userId: string, mediaId: string | null): Promise<void> {
  const { error } = await supabase.from('profiles').update({ avatar_media_id: mediaId }).eq('id', userId);
  if (error) throw error;
}
