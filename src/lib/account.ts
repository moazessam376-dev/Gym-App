// Account management actions that must run server-side (§2): account deletion is a
// privileged erasure performed by the account-delete Edge Function as the service
// role. The client only triggers it (authenticated) and then signs out.
import { supabase } from './supabase';

/**
 * Permanently delete the signed-in user's account (PDPL right-to-erasure). The Edge
 * Function removes their stored files and the auth user (cascading all their rows).
 * On success the local session is cleared so the app returns to the sign-in screen.
 * Throws on failure — the caller shows a generic error.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('account-delete', { body: {} });
  if (error) throw error;
  // The auth user no longer exists; clear the local session/tokens.
  await supabase.auth.signOut();
}
