// media-finalize — the ENFORCER (Phase 4, §7). Turns an untrusted inbox upload
// into a servable, sanitized file recorded in public.media (the gatekeeper).
//
// Flow (all as the service role; owner taken from the VERIFIED JWT, §5):
//   1. The inbox_path's first segment must equal the caller — you finalize only
//      your OWN uploads.
//   2. (optional) a progress_entry link must belong to the caller.
//   3. download the inbox object; reject if empty or > 10 MB.
//   4. MAGIC-BYTE detect the real type; reject anything off the allowlist (a lying
//      extension/MIME can't get through — bytes are authoritative).
//   5. STRIP EXIF by re-encoding jpg/png via imagescript (decode→encode drops all
//      metadata incl. GPS); pdf passes through (no EXIF; PDF scrub deferred).
//   6. upload the sanitized bytes to the LOCKED `media` bucket, INSERT the media
//      row (this is the ONLY writer of that table), delete the inbox object.
// Any failure collapses to one generic error and best-effort cleans up (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { finalizeSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { Image } from 'imagescript';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (§7)

type Mime =
  | 'image/jpeg'
  | 'image/png'
  | 'application/pdf'
  | 'audio/mp4'
  | 'audio/mpeg'
  | 'audio/wav';

/** Detect the real content type from leading bytes — never trust extension/MIME. */
function detectType(b: Uint8Array): Mime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) {
    return 'application/pdf';
  }
  // ── Audio (voice notes, Phase 18) ──
  // M4A/MP4 (AAC): an 'ftyp' box at bytes 4..7 (what expo-audio records on iOS+Android).
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    return 'audio/mp4';
  }
  // MP3: ID3v2 tag ('ID3') or an MPEG-audio frame sync (0xFF Ex/Fx).
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  // WAV: 'RIFF' .... 'WAVE'.
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45
  ) {
    return 'audio/wav';
  }
  return null;
}

const EXT: Record<Mime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

const AUDIO_MIMES = new Set<Mime>(['audio/mp4', 'audio/mpeg', 'audio/wav']);

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
  const parsed = finalizeSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);
  const { inbox_path, kind, progress_entry_id } = parsed.data;

  // You may only finalize uploads under your own owner prefix.
  if (inbox_path.split('/')[0] !== caller.id) return json({ error: 'forbidden' }, 403);

  const svc = serviceClient();
  const dropInbox = async () => {
    try {
      await svc.storage.from('media-inbox').remove([inbox_path]);
    } catch (_) {
      /* best-effort */
    }
  };

  try {
    // Per-kind upload caps (§9 abuse / M-3). inbody stays 1 per UTC day (the AI read is a
    // coach action; this just caps how often a client uploads a new sheet). The other
    // kinds get a rolling hourly cap so a client can't exhaust storage by looping
    // media-create-upload + media-finalize (only inbody was capped before). Counts only
    // 'ready' rows for the caller; returns the generic {status:'daily_limit'} marker the
    // client already maps (§4 — no detail leak).
    const RATE: Record<string, { max: number; windowMs: number }> = {
      inbody: { max: 1, windowMs: 0 }, // special-cased to the UTC day below
      progress_photo: { max: 20, windowMs: 60 * 60 * 1000 },
      avatar: { max: 5, windowMs: 60 * 60 * 1000 },
      audio: { max: 10, windowMs: 60 * 60 * 1000 },
      other: { max: 20, windowMs: 60 * 60 * 1000 },
    };
    const rule = RATE[kind];
    if (rule) {
      let since: Date;
      if (kind === 'inbody') {
        since = new Date();
        since.setUTCHours(0, 0, 0, 0);
      } else {
        since = new Date(Date.now() - rule.windowMs);
      }
      const { count } = await svc
        .from('media')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', caller.id)
        .eq('kind', kind)
        .eq('status', 'ready')
        .gte('created_at', since.toISOString());
      if ((count ?? 0) >= rule.max) {
        await dropInbox();
        return json({ status: 'daily_limit' }, 200);
      }
    }

    // An optional weigh-in link must belong to the caller (service role bypasses
    // RLS, so we check ownership explicitly — no attaching to someone else's row).
    if (progress_entry_id) {
      const { data: pe } = await svc
        .from('progress_entries')
        .select('user_id')
        .eq('id', progress_entry_id)
        .maybeSingle();
      if (!pe || pe.user_id !== caller.id) {
        await dropInbox();
        return json({ error: 'invalid_request' }, 400);
      }
    }

    const { data: blob, error: dErr } = await svc.storage.from('media-inbox').download(inbox_path);
    if (dErr || !blob) return json({ error: 'invalid_file' }, 400);

    const raw = new Uint8Array(await blob.arrayBuffer());
    if (raw.length === 0 || raw.length > MAX_BYTES) {
      await dropInbox();
      return json({ error: 'invalid_file' }, 400);
    }

    const mime = detectType(raw);
    if (!mime) {
      await dropInbox();
      return json({ error: 'invalid_file' }, 400);
    }

    // Sanitize: re-encode images to strip EXIF; pass PDFs and audio through. (Voice
    // notes from expo-audio carry no location metadata; deep audio-tag scrubbing is
    // deferred, like the PDF scrub.)
    let clean: Uint8Array;
    if (mime === 'application/pdf' || AUDIO_MIMES.has(mime)) {
      clean = raw;
    } else {
      const img = await Image.decode(raw);
      clean = mime === 'image/png' ? await img.encode() : await img.encodeJPEG(85);
    }
    if (clean.length > MAX_BYTES) {
      await dropInbox();
      return json({ error: 'invalid_file' }, 400);
    }

    const mediaId = crypto.randomUUID();
    const finalPath = `${caller.id}/${mediaId}.${EXT[mime]}`;

    const { error: uErr } = await svc.storage
      .from('media')
      .upload(finalPath, clean, { contentType: mime, upsert: false });
    if (uErr) {
      await dropInbox();
      return json({ error: 'invalid_file' }, 400);
    }

    const { data: row, error: iErr } = await svc
      .from('media')
      .insert({
        id: mediaId,
        owner_id: caller.id,
        kind,
        status: 'ready',
        bucket: 'media',
        path: finalPath,
        mime_type: mime,
        size_bytes: clean.length,
        progress_entry_id: progress_entry_id ?? null,
      })
      .select('id')
      .single();
    if (iErr || !row) {
      try {
        await svc.storage.from('media').remove([finalPath]); // don't orphan bytes
      } catch (_) {
        /* best-effort */
      }
      await dropInbox();
      return json({ error: 'invalid_file' }, 400);
    }

    await dropInbox(); // raw inbox copy no longer needed
    return json({ media_id: row.id }, 200);
  } catch (e) {
    console.error('media-finalize failed', { message: String(e) });
    await dropInbox();
    return json({ error: 'invalid_file' }, 400);
  }
});
