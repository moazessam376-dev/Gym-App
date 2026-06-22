// inbody-ocr — read an uploaded InBody sheet with a vision model and stage the numbers
// as an UNVERIFIED body_metrics row (Phase 12b). The anti-cheat anchor (foundations §4)
// is preserved: this inserts source='inbody_ocr', which the 0026 trigger forces UNVERIFIED,
// so it never feeds ranks/progress until the COACH confirms it (a separate UPDATE that
// flips source→coach_entered and stamps the verifier). The athlete still cannot write a
// verified metric — the service role only stages an unverified one on their behalf.
//
// All as the service role; the owner comes from the VERIFIED JWT (§5), never the body.
// The provider is chosen by config (VisionProvider adapter) — Groq for the pilot, Claude
// at launch. Per-user rate limit (§9) via the ai_usage_events ledger; the attempt is
// recorded BEFORE the model call so a failure still consumes a slot (fail-closed — can't
// burn the provider quota by hammering a failing request). Generic errors to the client;
// details logged server-side only (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { inbodyOcrSchema } from '../_shared/schemas.ts';
import { corsHeaders, json } from '../_shared/http.ts';
import { getVisionProvider } from '../_shared/vision.ts';
import { encodeBase64 } from '@std/encoding/base64';

const RATE_LIMIT = 5; // attempts per hour per user (§9)
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
    // 1. The scan must be the caller's OWN, an inbody kind, ready, and an image.
    //    (service role bypasses RLS, so ownership is checked explicitly here.)
    const { data: media } = await svc
      .from('media')
      .select('owner_id, kind, status, bucket, path, mime_type')
      .eq('id', media_id)
      .maybeSingle();
    if (!media || media.owner_id !== caller.id || media.kind !== 'inbody' || media.status !== 'ready') {
      return json({ error: 'invalid_request' }, 400);
    }
    if (media.mime_type !== 'image/jpeg' && media.mime_type !== 'image/png') {
      // PDF scans aren't OCR'd in the pilot (Groq vision is image-only) — the coach
      // enters those manually (12a). Not an error; the UI offers manual entry.
      return json({ status: 'unsupported_type' }, 200);
    }

    // 2. Dedupe: body_metrics.media_id is UNIQUE (one reading per scan). If we already
    //    read this scan, return it — no model call, no rate-limit slot consumed.
    const { data: existing } = await svc
      .from('body_metrics')
      .select('id')
      .eq('media_id', media_id)
      .maybeSingle();
    if (existing) return json({ status: 'already_extracted', metric_id: existing.id }, 200);

    // 3. Rate limit (§9): ≤ RATE_LIMIT inbody_ocr attempts per rolling hour per user.
    const since = new Date(Date.now() - WINDOW_MS).toISOString();
    const { count } = await svc
      .from('ai_usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', caller.id)
      .eq('kind', 'inbody_ocr')
      .gte('created_at', since);
    if ((count ?? 0) >= RATE_LIMIT) return json({ status: 'rate_limited' }, 200);

    // 4. Record the attempt BEFORE the model call (fail-closed). The ledger is
    //    service-role-write-only (0027) — the client can never forge a slot.
    const provider = getVisionProvider();
    await svc
      .from('ai_usage_events')
      .insert({ user_id: caller.id, kind: 'inbody_ocr', provider: provider.name });

    // 5. Download the sanitized bytes from the private bucket; base64 for the provider.
    const { data: blob, error: dErr } = await svc.storage.from(media.bucket).download(media.path);
    if (dErr || !blob) {
      console.error('inbody-ocr download failed', { message: dErr?.message });
      return json({ error: 'server_error' }, 500);
    }
    const base64 = encodeBase64(new Uint8Array(await blob.arrayBuffer()));

    // 6. Vision extract (Zod-validated inside the adapter). A provider/parse failure is
    //    surfaced as a generic 'failed' status; details stay server-side (§4).
    let raw;
    try {
      raw = await provider.extractInBody(base64, media.mime_type as ImageMime);
    } catch (e) {
      console.error('inbody-ocr vision failed', { message: String(e) });
      return json({ status: 'failed' }, 200);
    }

    // 7. A non-sheet photo (or one with no legible weight) reads as empty, not invented.
    if (!raw.is_inbody_sheet || raw.weight_kg == null) return json({ status: 'not_readable' }, 200);

    // 8. Convert human units → integer storage units (same as the coach form) and INSERT
    //    UNVERIFIED. The 0026 trigger nulls verified_* for source='inbody_ocr'.
    const measured_at = raw.measured_on ? new Date(`${raw.measured_on}T00:00:00Z`).toISOString() : undefined;
    const { data: inserted, error: iErr } = await svc
      .from('body_metrics')
      .insert({
        user_id: caller.id,
        source: 'inbody_ocr',
        media_id,
        weight_grams: Math.round(raw.weight_kg * 1000),
        body_fat_bp: raw.body_fat_pct == null ? null : Math.round(raw.body_fat_pct * 100),
        skeletal_muscle_mass_grams:
          raw.skeletal_muscle_mass_kg == null ? null : Math.round(raw.skeletal_muscle_mass_kg * 1000),
        body_fat_mass_grams: raw.body_fat_mass_kg == null ? null : Math.round(raw.body_fat_mass_kg * 1000),
        visceral_fat_level: raw.visceral_fat_level,
        bmr_kcal: raw.bmr_kcal,
        ...(measured_at ? { measured_at } : null),
      })
      .select('id')
      .single();
    if (iErr || !inserted) {
      // A UNIQUE(media_id) violation means a concurrent call already inserted it.
      console.error('inbody-ocr insert failed', { message: iErr?.message });
      return json({ status: 'failed' }, 200);
    }

    return json({ status: 'extracted', metric_id: inserted.id }, 200);
  } catch (e) {
    console.error('inbody-ocr error', { message: String(e) });
    return json({ error: 'server_error' }, 500);
  }
});
