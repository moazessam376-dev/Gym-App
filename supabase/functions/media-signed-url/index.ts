// media-signed-url — mint a SHORT-LIVED signed URL for a sanitized media object.
//
// Phase 4 (§7: private buckets, signed URLs only). Authorization is delegated to
// the database: we SELECT the row through a client bound to the CALLER'S token, so
// `media`'s RLS (owner / their coach / admin) decides whether the row is visible.
// Only then does the service role mint the signed URL. A row the caller can't read
// is indistinguishable from one that doesn't exist (404). Generic errors (§4).
import { getCaller, callerClient, serviceClient } from '../_shared/clients.ts';
import { signedUrlSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';

const TTL_SECONDS = 60; // short-lived (§7)

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
  const parsed = signedUrlSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  // Read under the caller's own RLS — they only see media they're allowed to.
  const scoped = callerClient(req);
  if (!scoped) return json({ error: 'unauthorized' }, 401);
  const { data: row, error } = await scoped
    .from('media')
    .select('bucket, path')
    .eq('id', parsed.data.media_id)
    .maybeSingle();
  if (error || !row) return json({ error: 'not_found' }, 404);

  const { data: signed, error: sErr } = await serviceClient()
    .storage.from(row.bucket)
    .createSignedUrl(row.path, TTL_SECONDS);
  if (sErr || !signed) {
    console.error('createSignedUrl failed', { message: sErr?.message });
    return json({ error: 'not_found' }, 404);
  }

  return json({ url: signed.signedUrl, expires_in: TTL_SECONDS }, 200);
});
