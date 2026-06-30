// resolve-call-request — a coach accepts or declines a client's call booking request
// addressed to them (Calls Phase A).
//
// Flow mirrors resolve-coach-request: verify the caller (Supabase Auth) → Zod-validate →
// call resolve_call_request as the service role. The RPC enforces that the call is a
// PENDING client_request addressed to this coach (its coach_id must equal the caller), so
// no extra role read is needed here — a non-addressed caller simply matches no pending row
// and gets a generic error. The slot status follows the call via tg_calls_sync_slot, and
// the client is notified (call_accepted / call_declined). Generic errors only (§4).
import { z } from 'zod';
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { corsHeaders, json } from '../_shared/http.ts';

// Inlined (not imported from _shared/schemas.ts) to keep the deploy bundle minimal.
const resolveCallRequestSchema = z.object({
  call_id: z.string().uuid(),
  decision: z.enum(['accept', 'decline']),
});

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

  const parsed = resolveCallRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  const svc = serviceClient();
  const { error } = await svc.rpc('resolve_call_request', {
    p_call: parsed.data.call_id,
    p_decision: parsed.data.decision,
    p_coach: caller.id,
  });

  if (error) {
    console.error('resolve_call_request failed', { code: error.code, message: error.message });
    return json({ error: 'request_invalid' }, 400);
  }

  return json({ ok: true }, 200);
});
