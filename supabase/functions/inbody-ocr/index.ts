// inbody-ocr — the COACH reads a client's uploaded InBody sheet with a vision model and
// stages the numbers as an UNVERIFIED body_metrics row for that client (Phase 12b). The
// anti-cheat anchor (foundations §4) holds: the row is source='inbody_ocr' (0026 trigger
// forces verified_*=null), so it doesn't feed ranks/progress until the coach confirms it
// (a separate UPDATE that flips source→coach_entered and stamps the verifier).
//
// COACH-ONLY: the caller must coach the scan's owner (or be an admin). Athletes upload the
// sheet but never trigger the read — enforced server-side here, not just hidden in the UI.
// The "limit" the founder asked for is one read per scan: body_metrics.media_id is UNIQUE,
// so re-reading the same sheet returns the cached row at no cost. A generous per-coach
// hourly backstop (§9) only guards against a runaway loop. The owner comes from the media
// row; identity from the verified JWT (§5). Generic errors; details server-side (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { inbodyOcrSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { getVisionProvider } from '../_shared/vision.ts';
import { encodeBase64 } from '@std/encoding/base64';

const RATE_LIMIT = 60; // per-coach hourly backstop (the real cap is per-scan dedupe) (§9)
const WINDOW_MS = 60 * 60 * 1000;

type ImageMime = 'image/jpeg' | 'image/png';

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
  const parsed = inbodyOcrSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'invalid_request' }, 400);
  const { media_id } = parsed.data;

  const svc = serviceClient();

  try {
    // 1. The scan must be an inbody kind, ready, and an image.
    const { data: media } = await svc
      .from('media')
      .select('owner_id, kind, status, bucket, path, mime_type')
      .eq('id', media_id)
      .maybeSingle();
    if (!media || media.kind !== 'inbody' || media.status !== 'ready') {
      return json({ error: 'invalid_request' }, 400);
    }

    // 2. Authorize: the caller must COACH the scan's owner (or be an admin). Athletes
    //    cannot trigger their own read — this is a coach tool (founder requirement).
    const [{ data: owner }, { data: callerProfile }] = await Promise.all([
      svc.from('profiles').select('coach_id').eq('id', media.owner_id).maybeSingle(),
      svc.from('profiles').select('role').eq('id', caller.id).maybeSingle(),
    ]);
    const isCoach = owner?.coach_id != null && owner.coach_id === caller.id;
    const isAdmin = callerProfile?.role === 'admin';
    if (!isCoach && !isAdmin) return json({ error: 'forbidden' }, 403);

    if (media.mime_type !== 'image/jpeg' && media.mime_type !== 'image/png') {
      // PDF scans aren't OCR'd in the pilot (Groq vision is image-only) — enter manually.
      return json({ status: 'unsupported_type' }, 200);
    }

    // 3. Dedupe: one reading per scan (body_metrics.media_id is UNIQUE). Already read →
    //    return it; no model call, no rate-limit slot.
    const { data: existing } = await svc
      .from('body_metrics')
      .select('id')
      .eq('media_id', media_id)
      .maybeSingle();
    if (existing) return json({ status: 'already_extracted', metric_id: existing.id }, 200);

    // 4. Per-coach hourly backstop (§9).
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await svc
      .from('ai_usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', caller.id)
      .eq('kind', 'inbody_ocr')
      .gte('created_at', since);
    if ((count ?? 0) >= RATE_LIMIT) return json({ status: 'rate_limited' }, 200);

    // 5. Record the attempt (the coach) BEFORE the model call (fail-closed).
    const provider = getVisionProvider();
    await svc
      .from('ai_usage_events')
      .insert({ user_id: caller.id, kind: 'inbody_ocr', provider: provider.name });

    // 6. Download sanitized bytes from the private bucket; base64 for the provider.
    const { data: blob, error: dErr } = await svc.storage.from(media.bucket).download(media.path);
    if (dErr || !blob) {
      console.error('inbody-ocr download failed', { message: dErr?.message });
      return json({ error: 'server_error' }, 500);
    }
    const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()));

    // 7. Vision extract (Zod-validated in the adapter).
    let raw;
    try {
      raw = await provider.extractInBody(base64, media.mime_type as ImageMime);
    } catch (e) {
      console.error('inbody-ocr vision failed', { message: String(e) });
      return json({ status: 'failed' }, 200);
    }

    if (!raw.is_inbody_sheet || raw.weight_kg == null) return json({ status: 'not_readable' }, 200);

    // 8. Convert to integer storage units + INSERT UNVERIFIED for the CLIENT (owner).
    //    extras (segmental/history/scores) are stored as-is for the coach's reference.
    const measured_at = raw.measured_on ? new Date(`${raw.measured_on}T00:00:00Z`).toISOString() : undefined;
    const { data: inserted, error: iErr } = await svc
      .from('body_metrics')
      .insert({
        user_id: media.owner_id,
        source: 'inbody_ocr',
        media_id,
        weight_grams: Math.round(raw.weight_kg * 1000),
        body_fat_bp: raw.body_fat_pct == null ? null : Math.round(raw.body_fat_pct * 100),
        skeletal_muscle_mass_grams:
          raw.skeletal_muscle_mass_kg == null ? null : Math.round(raw.skeletal_muscle_mass_kg * 1000),
        body_fat_mass_grams: raw.body_fat_mass_kg == null ? null : Math.round(raw.body_fat_mass_kg * 1000),
        visceral_fat_level: raw.visceral_fat_level,
        bmr_kcal: raw.bmr_kcal,
        extras: raw.extras ?? null,
        ...(measured_at ? { measured_at } : null),
      })
      .select('id')
      .single();
    if (iErr || !inserted) {
      console.error('inbody-ocr insert failed', { message: iErr?.message });
      return json({ status: 'failed' }, 200);
    }

    return json({ status: 'extracted', metric_id: inserted.id }, 200);
  } catch (e) {
    console.error('inbody-ocr error', { message: String(e) });
    return json({ error: 'server_error' }, 500);
  }
});
