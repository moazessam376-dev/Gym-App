// review-coach-application — an admin approves/rejects a coach application.
//
// Approving flips the applicant's role to 'coach' — a server-side-only mutation
// (CLAUDE.md §2/§5). Flow: verify the caller (Supabase Auth) → confirm they are
// an admin by reading profiles.role with the SERVICE-ROLE client (authoritative;
// the role lives in a custom JWT claim getUser() doesn't surface) → Zod-validate
// → call the review_coach_application RPC (the only writer of application status
// + the role flip) as the service role. Generic errors (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { reviewApplicationSchema } from '../_shared/schemas.ts';
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

  const parsed = reviewApplicationSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  const { error } = await svc.rpc('review_coach_application', {
    p_app: parsed.data.application_id,
    p_approve: parsed.data.approve,
    p_reviewer: caller.id,
  });

  if (error) {
    console.error('review_coach_application failed', { code: error.code, message: error.message });
    return json({ error: 'review_invalid' }, 400);
  }

  return json({ ok: true }, 200);
});
