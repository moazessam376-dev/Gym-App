// resolve-coach-request — a coach accepts (links the client) or declines a request
// addressed to them (Slice G2).
//
// Accept writes profiles.coach_id, which is client-immutable and service-role-only
// (CLAUDE.md §2). Flow mirrors assign-client / resolve-ban-appeal: verify the caller
// (Supabase Auth) → Zod-validate → call resolve_coach_request as the service role. The
// RPC itself enforces that the request is PENDING and addressed to this coach (its
// coach_id must equal the caller), so no extra role read is needed here — a non-addressed
// caller simply matches no pending row and gets a generic error. Generic errors only (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { resolveCoachRequestSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await getCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const parsed = resolveCoachRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  const svc = serviceClient();
  const { error } = await svc.rpc('resolve_coach_request', {
    p_request: parsed.data.request_id,
    p_decision: parsed.data.decision,
    p_coach: caller.id,
  });

  if (error) {
    console.error('resolve_coach_request failed', { code: error.code, message: error.message });
    return json({ error: 'request_invalid' }, 400);
  }

  return json({ ok: true }, 200);
});
