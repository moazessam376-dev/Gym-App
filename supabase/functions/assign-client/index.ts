// assign-client — a coach directly links an existing, unassigned client to
// THEMSELVES (no invitation flow).
//
// The coach is taken from the VERIFIED JWT (caller.id), so a coach can only ever
// assign to their own roster — never to another coach (the "assign to coach B"
// attack is structurally impossible here). The assign_client RPC runs as the
// service role (the only writer of coach_id, §2) and additionally enforces that
// the actor is a coach and the target is an unassigned client. Generic errors (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { assignClientSchema } from '../_shared/schemas.ts';
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

  const parsed = assignClientSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  const { error } = await serviceClient().rpc('assign_client', {
    p_coach: caller.id,
    p_client: parsed.data.client_id,
  });

  if (error) {
    console.error('assign_client failed', { code: error.code, message: error.message });
    return json({ error: 'assignment_invalid' }, 400);
  }

  return json({ ok: true }, 200);
});
