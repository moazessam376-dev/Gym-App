// admin-set-ban — an admin bans / unbans a user from the user-search console (Slice G3).
//
// profiles.banned_at is client-immutable and service-role-only (CLAUDE.md §2). Flow mirrors
// resolve-ban-appeal: verify the caller (Supabase Auth) → confirm they are an admin by
// reading profiles.role with the SERVICE-ROLE client (authoritative, not a possibly-stale
// claim) → Zod-validate → set banned_at as the service role. An admin can never be banned
// (so admins can't lock each other out). A ban blocks SENDING only, not access (Phase 18).
// Generic errors only (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { adminSetBanSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await getCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  const svc = serviceClient();

  const { data: me, error: roleErr } = await svc
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .maybeSingle();
  if (roleErr || me?.role !== 'admin') return json({ error: 'forbidden' }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const parsed = adminSetBanSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);
  const { user_id, banned } = parsed.data;

  // Never ban an admin account.
  const { data: target, error: targetErr } = await svc
    .from('profiles')
    .select('role')
    .eq('id', user_id)
    .maybeSingle();
  if (targetErr || !target) return json({ error: 'invalid_request' }, 400);
  if (banned && target.role === 'admin') return json({ error: 'forbidden' }, 403);

  const { error } = await svc
    .from('profiles')
    .update({ banned_at: banned ? new Date().toISOString() : null })
    .eq('id', user_id);
  if (error) {
    console.error('admin-set-ban failed', { code: error.code, message: error.message });
    return json({ error: 'update_failed' }, 400);
  }

  return json({ ok: true }, 200);
});
