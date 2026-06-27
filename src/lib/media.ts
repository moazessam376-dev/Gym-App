// Data layer for secure media uploads (CLAUDE.md §7). UI-independent — the upload
// screen (and on-device HEIC→JPEG conversion) come in the UI pass; this is the
// transport.
//
// Three-step pipeline, all behind the gatekeeper `public.media`:
//   1. requestUpload  → media-create-upload mints a signed URL into the locked
//                       `media-inbox` bucket (no row yet).
//   2. uploadToInbox  → bytes go straight to the signed URL.
//   3. finalizeUpload → media-finalize validates magic bytes, STRIPS EXIF, promotes
//                       to the `media` bucket, and inserts the media row.
// Reads are RLS-scoped; bytes are fetched via a short-lived signed URL only.
import { supabase } from './supabase';
import {
  createUploadSchema,
  finalizeSchema,
  signedUrlSchema,
  type CreateUpload,
  type FinalizeUpload,
  type MediaKind,
  type MediaMime,
} from '../schemas/media';

export type Media = {
  id: string;
  owner_id: string;
  kind: MediaKind;
  status: 'ready' | 'quarantined' | 'failed';
  bucket: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  progress_entry_id: string | null;
  created_at: string;
};

const MEDIA_COLS =
  'id, owner_id, kind, status, bucket, path, mime_type, size_bytes, progress_entry_id, created_at';
const INBOX_BUCKET = 'media-inbox';

export type SignedUpload = { bucket: string; path: string; token: string };

/** Step 1 — get a one-time signed upload URL for the locked inbox. */
export async function requestUpload(input: CreateUpload): Promise<SignedUpload> {
  const body = createUploadSchema.parse(input);
  const { data, error } = await supabase.functions.invoke('media-create-upload', { body });
  if (error) throw error;
  return data as SignedUpload;
}

/**
 * Step 2 — upload the (already JPEG/PNG/PDF) bytes to the signed inbox URL.
 * On React Native, Blob/File/FormData upload as 0 bytes — supabase-js requires raw
 * ArrayBuffer/typed-array data, so callers pass a Uint8Array (see src/lib/upload.ts).
 */
export async function uploadToInbox(
  path: string,
  token: string,
  file: ArrayBuffer | ArrayBufferView,
  contentType: MediaMime,
): Promise<void> {
  const { error } = await supabase.storage
    .from(INBOX_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType });
  if (error) throw error;
}

/**
 * Result of finalizing an upload: the new media id, or a `dailyLimit` marker when the
 * server caps the upload (InBody is one-per-day per athlete — Phase 12b).
 */
export type FinalizeResult = { mediaId: string } | { dailyLimit: true };

/** Step 3 — sanitize + register; returns the new media id (or the daily-limit marker). */
export async function finalizeUpload(input: FinalizeUpload): Promise<FinalizeResult> {
  const body = finalizeSchema.parse(input);
  const { data, error } = await supabase.functions.invoke('media-finalize', { body });
  if (error) throw error;
  const d = data as { media_id?: string; status?: string };
  if (d?.status === 'daily_limit') return { dailyLimit: true };
  if (!d?.media_id) throw new Error('finalize_failed');
  return { mediaId: d.media_id };
}

/**
 * End-to-end convenience: request → upload → finalize. The `file` bytes MUST already
 * be JPEG/PNG/PDF (convert HEIC→JPEG on-device first, §7 — the server rejects the
 * rest). Pass raw bytes (Uint8Array/ArrayBuffer), not a Blob (see uploadToInbox).
 * Returns the new media id, or a `dailyLimit` marker (InBody is one-per-day per athlete).
 */
export async function uploadMedia(args: {
  file: ArrayBuffer | ArrayBufferView;
  mimeType: MediaMime;
  kind: MediaKind;
  progressEntryId?: string;
}): Promise<FinalizeResult> {
  const { file, mimeType, kind, progressEntryId } = args;
  const { path, token } = await requestUpload({ mime_type: mimeType, size_bytes: file.byteLength });
  await uploadToInbox(path, token, file, mimeType);
  return finalizeUpload({ inbox_path: path, kind, progress_entry_id: progressEntryId });
}

/**
 * Permanently delete one of the caller's OWN media objects (a progress photo or
 * InBody scan) — bytes + row — via the media-delete Edge Function. Deletion can't be
 * client-side: the buckets are locked and `media` is service-role-write-only (§7).
 * The server enforces owner-only; a coach can view but not delete a client's media.
 */
export async function deleteMedia(mediaId: string): Promise<void> {
  const body = signedUrlSchema.parse({ media_id: mediaId });
  const { error } = await supabase.functions.invoke('media-delete', { body });
  if (error) throw error;
}

/** A short-lived signed URL to view a media object (RLS-authorized server-side). */
export async function getSignedUrl(mediaId: string): Promise<string> {
  const body = signedUrlSchema.parse({ media_id: mediaId });
  const { data, error } = await supabase.functions.invoke('media-signed-url', { body });
  if (error) throw error;
  return (data as { url: string }).url;
}

/**
 * Media owned by `ownerId`, newest first (optionally filtered by kind). Only
 * `ready` rows — quarantined/failed uploads are never servable, so they must not
 * appear in timelines or counts. RLS limits results to what the caller may read
 * (own / their coach's clients / admin).
 */
export async function listMediaFor(ownerId: string, kind?: MediaKind): Promise<Media[]> {
  let query = supabase
    .from('media')
    .select(MEDIA_COLS)
    .eq('owner_id', ownerId)
    .eq('status', 'ready')
    .order('created_at', { ascending: false });
  if (kind) query = query.eq('kind', kind);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Media[];
}

/**
 * Count of `ready` media for `ownerId` (optionally by kind), without transferring
 * the rows — for hint badges on high-traffic screens. RLS-scoped like listMediaFor.
 */
export async function countMediaFor(ownerId: string, kind?: MediaKind): Promise<number> {
  let query = supabase
    .from('media')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('status', 'ready');
  if (kind) query = query.eq('kind', kind);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/**
 * How many `ready` InBody scans `ownerId` has uploaded so far *today* (the device's local
 * day). Drives the athlete's one-submission-per-day gate (Phase 12b); the server enforces
 * the same cap (UTC day) in media-finalize.
 */
export async function countInbodyToday(ownerId: string): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('media')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('kind', 'inbody')
    .eq('status', 'ready')
    .gte('created_at', start.toISOString());
  if (error) throw error;
  return count ?? 0;
}
