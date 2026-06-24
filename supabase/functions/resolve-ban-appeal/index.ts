// resolve-ban-appeal — an admin approves (unban) or rejects a banned user's appeal.
//
// Approve / reject are server-side-only mutations (CLAUDE.md §2/§8): approve flips
// profiles.banned_at back to null, which is client-immutable. Flow mirrors
// moderate-message-report: verify the caller (Supabase Auth) → confirm they are an
// admin by reading profiles.role with the SERVICE-ROLE client (authoritative) →
// Zod-validate → call resolve_ban_appeal (the only writer of appeal status + the
// unban) as the service role. Generic errors only (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { resolveAppealSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await getCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  const svc = serviceClient();

  // Authoritative admin check against the DB role (not a possibly-stale claim).
  const { data: profile, error: roleErr } = await svc
    .from('profiles')
    .select('role')
    .eq('id', caller.id)
    .maybeSingle();
  if (roleErr || profile?.role !== 'admin') {
    return json({ error: 'forbidden' }, 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const parsed = resolveAppealSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  const { error } = await svc.rpc('resolve_ban_appeal', {
    p_appeal: parsed.data.appeal_id,
    p_decision: parsed.data.decision,
    p_reviewer: caller.id,
  });

  if (error) {
    console.error('resolve_ban_appeal failed', { code: error.code, message: error.message });
    return json({ error: 'moderate_invalid' }, 400);
  }

  return json({ ok: true }, 200);
});
