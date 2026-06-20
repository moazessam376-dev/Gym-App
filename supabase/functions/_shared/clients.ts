// Supabase clients for Edge Functions.
//
// Two clients with very different trust levels:
//   • the service-role client performs the privileged writes (the only path
//     allowed to mutate coach_id / invitation status, §2). Its key is read from
//     the auto-injected SUPABASE_SERVICE_ROLE_KEY secret and NEVER returned to
//     the caller (§3).
//   • a per-request anon client bound to the caller's bearer token resolves and
//     VERIFIES who is calling. The role/identity comes from the verified JWT,
//     never from request input (§5).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// SUPABASE_URL / *_KEY are injected into the Edge Function runtime by the
// platform — no secret is hardcoded or bundled (§3).
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

/** The trusted server path (BYPASSes RLS). Used only for privileged RPC calls. */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Caller {
  id: string;
  email: string | null;
}

/**
 * Resolve the caller from their Authorization bearer token, verifying it against
 * Supabase Auth. Returns null when the token is missing or invalid — callers map
 * that to a generic 401.
 */
export async function getCaller(req: Request): Promise<Caller | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const scoped = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await scoped.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/**
 * A Supabase client bound to the caller's bearer token, so reads run UNDER THE
 * CALLER'S RLS (not the service role). Used where the DB's row policies should be
 * the authorizer — e.g. media-signed-url only mints a URL for a media row the
 * caller is actually allowed to read. Returns null when no token is present.
 */
export function callerClient(req: Request): SupabaseClient | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
