// Client entry point for InBody OCR (Phase 12b). The athlete asks the server to read an
// already-uploaded scan; the inbody-ocr Edge Function runs the vision provider and stages
// an UNVERIFIED body_metrics row for the coach to confirm. The model key + provider live
// server-side (§3) — nothing here knows or cares which provider is used.
import { supabase } from './supabase';

// Expected flow states the function returns as HTTP 200 (vs. genuine errors → 'failed').
export type OcrStatus =
  | 'extracted' // a new unverified reading was staged
  | 'already_extracted' // this scan was read before (deduped)
  | 'not_readable' // not an InBody sheet, or no legible weight
  | 'rate_limited' // hit the per-hour cap (§9)
  | 'unsupported_type' // PDF scan — coach enters manually (12a)
  | 'failed'; // provider/transport/parse error, or an unexpected response

export type OcrResult = { status: OcrStatus; metric_id?: string };

/**
 * Request OCR for an uploaded InBody scan (`media` row id). Returns a typed status the UI
 * branches on. A non-2xx from the function (auth / bad input / server error) is mapped to
 * 'failed' — we never surface raw error detail to the user (§4).
 */
export async function requestInBodyOcr(mediaId: string): Promise<OcrResult> {
  const { data, error } = await supabase.functions.invoke('inbody-ocr', {
    body: { media_id: mediaId },
  });
  if (error || !data || typeof (data as OcrResult).status !== 'string') {
    return { status: 'failed' };
  }
  return data as OcrResult;
}
