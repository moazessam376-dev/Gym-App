// Coach transformations — the WRITE side (the coach's curate editor). Reads/writes go
// through coach_transformations RLS (coach_id = auth.uid(), and a coach may only feature a
// client they actually coach via the WITH CHECK in 0077). 0087: a client can have MULTIPLE
// cards (insert, not upsert) and a card owns ordered transformation_photos child rows —
// before/after_media_id stay as a denormalized first/last mirror so pre-0087 builds and
// legacy rows keep working. The PUBLIC showcase read path is the separate
// get_coach_transformations RPC (src/lib/public-profiles.ts).
import { supabase } from './supabase';
import {
  coerceCardStyle,
  coerceLayout,
  coercePhotos,
  synthesizePhotos,
  type CardStyle,
  type PhotoFrame,
  type TransformationCardInput,
  type TransformationLayout,
  type TransformationPhoto,
  type TransformationPhotoInput,
} from './public-profiles';
import type { TierId } from './leagues';

export type MyTransformation = {
  id: string;
  client_id: string;
  caption: string | null;
  before_media_id: string | null;
  after_media_id: string | null;
  client_name: string | null;
  // Editable overrides / presentation (for pre-filling the editor when editing an existing card).
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
  before_metric_id: string | null;
  after_metric_id: string | null;
  photos: TransformationPhoto[];
  style: CardStyle;
};

const EDIT_COLS =
  'id, client_id, caption, before_media_id, after_media_id, duration_weeks_override, body_fat_delta_bp_override, lean_mass_delta_grams_override, tier_before_override, tier_after_override, measurement_started_at, measurement_ended_at, layout, before_frame, after_frame, before_metric_id, after_metric_id, style';

/** A coach's clients who have consented to be featured (allow_transformation_sharing). */
export type ConsentingClient = { user_id: string; full_name: string | null; avatar_media_id: string | null };

// PostgREST returns a to-one embed as a single object at runtime, but supabase-js types it
// as an array — normalize either shape to the object (or null).
function one<T>(embed: T | T[] | null | undefined): T | null {
  if (embed == null) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/** The coach's own transformation rows + the featured client's display name. */
export async function listMyTransformations(coachId: string): Promise<MyTransformation[]> {
  const { data, error } = await supabase
    .from('coach_transformations')
    .select(
      `${EDIT_COLS}, client:profiles!client_id(full_name), photos:transformation_photos(media_id, taken_on, frame, position)`,
    )
    .eq('coach_id', coachId)
    .order('featured_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const client = one<{ full_name: string | null }>(r.client);
    const before_frame = (r.before_frame ?? null) as PhotoFrame | null;
    const after_frame = (r.after_frame ?? null) as PhotoFrame | null;
    const photos = coercePhotos(r.photos);
    const base = {
      id: r.id,
      client_id: r.client_id,
      caption: r.caption,
      before_media_id: r.before_media_id,
      after_media_id: r.after_media_id,
      client_name: client?.full_name ?? null,
      duration_weeks_override: r.duration_weeks_override,
      body_fat_delta_bp_override: r.body_fat_delta_bp_override,
      lean_mass_delta_grams_override: r.lean_mass_delta_grams_override,
      tier_before_override: (r.tier_before_override ?? null) as TierId | null,
      tier_after_override: (r.tier_after_override ?? null) as TierId | null,
      measurement_started_at: r.measurement_started_at,
      measurement_ended_at: r.measurement_ended_at,
      layout: coerceLayout(r.layout),
      before_frame,
      after_frame,
      before_metric_id: (r.before_metric_id ?? null) as string | null,
      after_metric_id: (r.after_metric_id ?? null) as string | null,
      style: coerceCardStyle(r.style),
    };
    return { ...base, photos: photos.length >= 2 ? photos : synthesizePhotos(base) };
  });
}

/** The coach's clients who opted in to transformation sharing. */
export async function listConsentingClients(coachId: string): Promise<ConsentingClient[]> {
  const { data, error } = await supabase
    .from('athlete_profile')
    .select('user_id, allow_transformation_sharing, profile:profiles!user_id(full_name, avatar_media_id, coach_id)')
    .eq('allow_transformation_sharing', true);
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({ user_id: r.user_id as string, profile: one<{ full_name: string | null; avatar_media_id: string | null; coach_id: string | null }>(r.profile) }))
    .filter((r) => r.profile?.coach_id === coachId)
    .map((r) => ({ user_id: r.user_id, full_name: r.profile?.full_name ?? null, avatar_media_id: r.profile?.avatar_media_id ?? null }));
}

/** First/last of the editor's photo slots → the denormalized before/after mirror columns. */
function mirrorColumns(input: TransformationCardInput): {
  before_media_id: string | null;
  after_media_id: string | null;
  before_frame: PhotoFrame | null;
  after_frame: PhotoFrame | null;
} {
  const photos = input.photos;
  if (photos && photos.length >= 2) {
    const first = photos[0];
    const last = photos[photos.length - 1];
    return {
      before_media_id: first.mediaId,
      after_media_id: last.mediaId,
      before_frame: first.frame,
      after_frame: last.frame,
    };
  }
  return {
    before_media_id: input.beforeMediaId,
    after_media_id: input.afterMediaId,
    before_frame: input.beforeFrame,
    after_frame: input.afterFrame,
  };
}

/** The parent-row column payload (allowlisted explicitly — §4, never spread input). */
function parentPayload(input: TransformationCardInput) {
  return {
    caption: input.caption,
    ...mirrorColumns(input),
    duration_weeks_override: input.durationWeeksOverride,
    body_fat_delta_bp_override: input.bodyFatDeltaBpOverride,
    lean_mass_delta_grams_override: input.leanMassDeltaGramsOverride,
    tier_before_override: input.tierBeforeOverride,
    tier_after_override: input.tierAfterOverride,
    measurement_started_at: input.measurementStartedAt,
    measurement_ended_at: input.measurementEndedAt,
    layout: input.layout,
    before_metric_id: input.beforeMetricId ?? null,
    after_metric_id: input.afterMetricId ?? null,
    style: input.cardStyle ?? null,
  };
}

/** The ordered photo child rows for a card (position = slot index). */
function photoRows(cardId: string, photos: TransformationPhotoInput[]) {
  return photos.map((p, i) => ({
    transformation_id: cardId,
    media_id: p.mediaId,
    position: i,
    taken_on: p.takenOn,
    frame: p.frame,
  }));
}

/** Create a NEW featured card (0087 multi-card: always an insert). The parent insert and the
 *  photo rows are two steps; if the photos fail we delete the parent so no half-card ships
 *  (pilot-accepted atomicity — the documented upgrade path is a single RPC). */
export async function createTransformation(
  input: { coachId: string; clientId: string } & TransformationCardInput,
): Promise<void> {
  const { data, error } = await supabase
    .from('coach_transformations')
    .insert({
      coach_id: input.coachId,
      client_id: input.clientId,
      featured_at: new Date().toISOString(),
      ...parentPayload(input),
    })
    .select('id')
    .single();
  if (error) throw error;
  const photos = input.photos ?? [];
  if (photos.length > 0) {
    const { error: photoErr } = await supabase.from('transformation_photos').insert(photoRows(data.id, photos));
    if (photoErr) {
      await supabase.from('coach_transformations').delete().eq('id', data.id);
      throw photoErr;
    }
  }
}

/** Update an existing card in place (photos are replaced wholesale: delete + reinsert). */
export async function updateTransformation(
  id: string,
  input: TransformationCardInput,
): Promise<void> {
  const { error } = await supabase
    .from('coach_transformations')
    .update({ featured_at: new Date().toISOString(), ...parentPayload(input) })
    .eq('id', id);
  if (error) throw error;
  const { error: delErr } = await supabase.from('transformation_photos').delete().eq('transformation_id', id);
  if (delErr) throw delErr;
  const photos = input.photos ?? [];
  if (photos.length > 0) {
    const { error: photoErr } = await supabase.from('transformation_photos').insert(photoRows(id, photos));
    if (photoErr) throw photoErr;
  }
}

export async function deleteTransformation(id: string): Promise<void> {
  const { error } = await supabase.from('coach_transformations').delete().eq('id', id);
  if (error) throw error;
}
