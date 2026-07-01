// Client-initiated before/after submissions (the athlete side of the E3 showcase, 0084).
// A client builds a before/after in their Progress section and SENDS it to their coach;
// the coach reviews PENDING ones in their Transformations editor and approves (features it
// publicly via resolve_transformation_submission → coach_transformations) or dismisses.
// All reads/writes go through transformation_submissions RLS (client_id = auth.uid() for the
// athlete; coach_id = auth.uid() for the coach). The approve/dismiss transition is the
// coach-only SECURITY DEFINER RPC — clients never feature their own card.
import { supabase } from './supabase';
import type { PhotoFrame, TransformationCardInput, TransformationLayout } from './public-profiles';
import type { TierId } from './leagues';

export type SubmissionStatus = 'pending' | 'approved' | 'dismissed';

export type MySubmission = {
  id: string;
  caption: string | null;
  before_media_id: string | null;
  after_media_id: string | null;
  status: SubmissionStatus;
  created_at: string;
  duration_weeks_override: number | null;
  body_fat_delta_bp_override: number | null;
  lean_mass_delta_grams_override: number | null;
  tier_before_override: TierId | null;
  tier_after_override: TierId | null;
  measurement_started_at: string | null;
  measurement_ended_at: string | null;
  layout: TransformationLayout;
  before_frame: PhotoFrame | null;
  after_frame: PhotoFrame | null;
};

export type PendingSubmission = MySubmission & {
  client_id: string;
  client_name: string | null;
  client_avatar_media_id: string | null;
};

const COLS =
  'id, caption, before_media_id, after_media_id, status, created_at, duration_weeks_override, body_fat_delta_bp_override, lean_mass_delta_grams_override, tier_before_override, tier_after_override, measurement_started_at, measurement_ended_at, layout, before_frame, after_frame';

// PostgREST returns a to-one embed as a single object at runtime but types it as an array
// — normalize either shape (mirrors coach-transformations.ts).
function one<T>(embed: T | T[] | null | undefined): T | null {
  if (embed == null) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapSubmissionRow(r: any): MySubmission {
  return {
    id: r.id,
    caption: r.caption,
    before_media_id: r.before_media_id,
    after_media_id: r.after_media_id,
    status: r.status as SubmissionStatus,
    created_at: r.created_at,
    duration_weeks_override: r.duration_weeks_override ?? null,
    body_fat_delta_bp_override: r.body_fat_delta_bp_override ?? null,
    lean_mass_delta_grams_override: r.lean_mass_delta_grams_override ?? null,
    tier_before_override: (r.tier_before_override ?? null) as TierId | null,
    tier_after_override: (r.tier_after_override ?? null) as TierId | null,
    measurement_started_at: r.measurement_started_at ?? null,
    measurement_ended_at: r.measurement_ended_at ?? null,
    layout: (r.layout === 'stack' ? 'stack' : 'side') as TransformationLayout,
    before_frame: (r.before_frame ?? null) as PhotoFrame | null,
    after_frame: (r.after_frame ?? null) as PhotoFrame | null,
  };
}

/** The signed-in client's own submissions (any status), newest first. */
export async function listMySubmissions(clientId: string): Promise<MySubmission[]> {
  const { data, error } = await supabase
    .from('transformation_submissions')
    .select(COLS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapSubmissionRow);
}

/** The coach's PENDING submissions to review, with the submitting client's name + avatar. */
export async function listPendingSubmissions(coachId: string): Promise<PendingSubmission[]> {
  const { data, error } = await supabase
    .from('transformation_submissions')
    .select(`${COLS}, client_id, client:profiles!client_id(full_name, avatar_media_id)`)
    .eq('coach_id', coachId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const client = one<{ full_name: string | null; avatar_media_id: string | null }>(r.client);
    return {
      ...mapSubmissionRow(r),
      client_id: r.client_id as string,
      client_name: client?.full_name ?? null,
      client_avatar_media_id: client?.avatar_media_id ?? null,
    };
  });
}

/** Create a pending submission addressed to the client's coach. RLS enforces ownership; fields
 *  are allowlisted explicitly (§4). */
export async function createSubmission(input: { clientId: string; coachId: string } & TransformationCardInput): Promise<void> {
  const { error } = await supabase.from('transformation_submissions').insert({
    client_id: input.clientId,
    coach_id: input.coachId,
    caption: input.caption,
    before_media_id: input.beforeMediaId,
    after_media_id: input.afterMediaId,
    status: 'pending',
    duration_weeks_override: input.durationWeeksOverride,
    body_fat_delta_bp_override: input.bodyFatDeltaBpOverride,
    lean_mass_delta_grams_override: input.leanMassDeltaGramsOverride,
    tier_before_override: input.tierBeforeOverride,
    tier_after_override: input.tierAfterOverride,
    measurement_started_at: input.measurementStartedAt,
    measurement_ended_at: input.measurementEndedAt,
    layout: input.layout,
    before_frame: input.beforeFrame,
    after_frame: input.afterFrame,
  });
  if (error) throw error;
}

/** Withdraw the client's own submission. */
export async function deleteSubmission(id: string): Promise<void> {
  const { error } = await supabase.from('transformation_submissions').delete().eq('id', id);
  if (error) throw error;
}

/** Coach approve/dismiss — the atomic SECURITY DEFINER transition (fenced on coach_id). */
export async function resolveSubmission(id: string, action: 'approve' | 'dismiss'): Promise<void> {
  const { error } = await supabase.rpc('resolve_transformation_submission', {
    p_submission: id,
    p_action: action,
  });
  if (error) throw error;
}

/**
 * Set the client's transformation-sharing consent (athlete_profile.allow_transformation_sharing).
 * Sending a submission is an explicit request to be featured, so we turn this on at submit time;
 * the client can revoke it anytime in Public presence, which hides every featured card instantly.
 * Independent of is_public (the card shows on the COACH's profile). Owner-only via RLS.
 */
export async function setTransformationConsent(clientId: string, value: boolean): Promise<void> {
  const { error } = await supabase
    .from('athlete_profile')
    .update({ allow_transformation_sharing: value })
    .eq('user_id', clientId);
  if (error) throw error;
}

/**
 * Copy one of the client's existing PROGRESS PHOTOS into a fresh `transformation`-kind media
 * (so it's servable on the public showcase without widening the private progress_photo read
 * path). Fetches the signed URL bytes and re-runs them through the upload pipeline; the server
 * re-encodes + strips EXIF like any other upload. Returns the new transformation media id.
 */
export async function copyProgressPhotoToTransformation(progressMediaId: string): Promise<string | null> {
  const { getSignedUrl, uploadMedia } = await import('./media');
  const url = await getSignedUrl(progressMediaId);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('fetch_failed');
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const res = await uploadMedia({ file: bytes, mimeType: 'image/jpeg', kind: 'transformation' });
  return 'mediaId' in res ? res.mediaId : null;
}
