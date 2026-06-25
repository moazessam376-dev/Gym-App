// media-create-upload — issue a one-time signed upload URL into the LOCKED inbox.
//
// Phase 4 (§7). After converting the picture to JPEG/PNG on-device, the client
// calls this to get a signed URL for the private `media-inbox` bucket. NO
// public.media row exists yet — the bytes are untrusted until media-finalize
// validates magic bytes + strips EXIF and promotes them. The owner comes from the
// VERIFIED JWT (§5), never the body; the path is server-chosen (no traversal).
// Generic errors only (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { createUploadSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

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
  const parsed = createUploadSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);

  // Server owns the path: {ownerId}/{random}.{ext}. media-finalize re-derives the
  // owner from the first segment and checks it equals the verified caller.
  const path = `${caller.id}/${crypto.randomUUID()}.${EXT[parsed.data.mime_type]}`;

  const { data, error } = await serviceClient()
    .storage.from('media-inbox')
    .createSignedUploadUrl(path);
  if (error || !data) {
    console.error('createSignedUploadUrl failed', { message: error?.message });
    return json({ error: 'upload_unavailable' }, 400);
  }

  return json({ bucket: 'media-inbox', path: data.path, token: data.token }, 200);
});
