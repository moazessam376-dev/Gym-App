// accept-invitation — the invitee redeems an invitation token.
//
// Flow: verify the caller (Supabase Auth) → Zod-validate the token → call the
// accept_invitation RPC with the SERVICE-ROLE client (the only writer of
// coach_id / invitation status, §2). The accepting user id + email come from the
// VERIFIED JWT, never from the request body. All failure paths collapse to one
// generic error; details are logged server-side only (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { acceptInvitationSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await getCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);
  // An invitation is bound to an email; a caller without a verified email can't
  // satisfy the server-side email match.
  if (!caller.email) return json({ error: 'invitation_invalid' }, 400);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const parsed = acceptInvitationSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  const { data, error } = await serviceClient().rpc('accept_invitation', {
    p_token: parsed.data.token,
    p_accepting_user: caller.id,
    p_accepting_email: caller.email,
  });

  if (error) {
    // Log details server-side; return a generic, opaque error to the client (§4).
    // Exception: `already_has_coach` concerns only the caller's own state (not
    // another tenant's data), so it's safe to surface as a distinct reason for a
    // clearer message. Everything else collapses to one opaque error.
    console.error('accept_invitation failed', { code: error.code, message: error.message });
    const reason = error.message?.includes('already_has_coach')
      ? 'already_has_coach'
      : 'invitation_invalid';
    return json({ error: reason }, 400);
  }

  return json({ ok: true, coach_id: data }, 200);
});
