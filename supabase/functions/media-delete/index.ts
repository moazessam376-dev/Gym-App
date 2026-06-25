// media-delete — let an OWNER delete their own progress photo / InBody scan.
//
// Phase 4 (§7). The `media` table is service-role-write-only and the storage
// buckets have NO object policies, so deletion CANNOT happen client-side — it must
// go through this function. Authorization: we read the row under the CALLER'S RLS,
// then require owner_id === caller. A coach/admin may READ a client's media but must
// not DELETE it, so a visible-but-not-owned row is a 403; an invisible one is a 404
// (indistinguishable from "doesn't exist"). All FKs to media(id) are ON DELETE SET
// NULL (body_metrics, voice notes, avatars), so the row delete never breaks a link.
// Generic errors to the client; details logged server-side only (§4).
import { getCaller, callerClient, serviceClient } from '../_shared/clients.ts';
import { signedUrlSchema } from '../_shared/schemas.ts';
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
  const parsed = signedUrlSchema.safeParse(body); // { media_id }
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  // Read under the caller's RLS, then require they OWN it (not just can read it).
  const scoped = callerClient(req);
  if (!scoped) return json({ error: 'unauthorized' }, 401);
  const { data: row, error } = await scoped
    .from('media')
    .select('owner_id, bucket, path')
    .eq('id', parsed.data.media_id)
    .maybeSingle();
  if (error || !row) return json({ error: 'not_found' }, 404);
  if (row.owner_id !== caller.id) return json({ error: 'forbidden' }, 403);

  const svc = serviceClient();
  // Bytes first: if the row delete then failed we'd rather leave an (invisible,
  // re-deletable) orphan row than orphaned private bytes in the bucket.
  const { error: rmErr } = await svc.storage.from(row.bucket).remove([row.path]);
  if (rmErr) {
    console.error('storage remove failed', { message: rmErr.message });
    return json({ error: 'delete_failed' }, 500);
  }
  const { error: delErr } = await svc.from('media').delete().eq('id', parsed.data.media_id);
  if (delErr) {
    console.error('media row delete failed', { message: delErr.message });
    return json({ error: 'delete_failed' }, 500);
  }

  return json({ ok: true }, 200);
});
