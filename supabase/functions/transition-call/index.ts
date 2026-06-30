// transition-call — either party moves a call through its lifecycle: start (→in_progress),
// complete (→completed), miss (→missed), cancel (→cancelled). (Calls Phase A.)
//
// Flow mirrors resolve-call-request: verify the caller → Zod-validate → call set_call_status
// as the service role with p_actor = caller.id (the only trusted actor id, from the verified
// JWT). The RPC enforces that the caller is a PARTY to the call (coach_id or client_id) AND
// the transition is legal for the row's origin + current status — a non-party caller matches
// no row and gets a generic error. The slot follows via tg_calls_sync_slot. Generic errors (§4).
import { z } from 'zod';
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { corsHeaders, json } from '../_shared/http.ts';

// Inlined (not imported from _shared/schemas.ts) to keep the deploy bundle minimal.
const transitionCallSchema = z.object({
  call_id: z.string().uuid(),
  event: z.enum(['start', 'complete', 'miss', 'cancel']),
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

  const parsed = transitionCallSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  const svc = serviceClient();
  const { error } = await svc.rpc('set_call_status', {
    p_call: parsed.data.call_id,
    p_actor: caller.id,
    p_event: parsed.data.event,
  });

  if (error) {
    console.error('set_call_status failed', { code: error.code, message: error.message });
    return json({ error: 'request_invalid' }, 400);
  }

  return json({ ok: true }, 200);
});
