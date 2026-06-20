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

/** Step 2 — upload the (already JPEG/PNG/PDF) bytes to the signed inbox URL. */
export async function uploadToInbox(
  path: string,
  token: string,
  file: Blob,
  contentType: MediaMime,
): Promise<void> {
  const { error } = await supabase.storage
    .from(INBOX_BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType });
  if (error) throw error;
}

/** Step 3 — sanitize + register; returns the new media id. */
export async function finalizeUpload(input: FinalizeUpload): Promise<string> {
  const body = finalizeSchema.parse(input);
  const { data, error } = await supabase.functions.invoke('media-finalize', { body });
  if (error) throw error;
  return (data as { media_id: string }).media_id;
}

/**
 * End-to-end convenience: request → upload → finalize. The `file` MUST already be
 * JPEG/PNG/PDF (convert HEIC→JPEG on-device first, §7 — the server rejects the
 * rest). Returns the new media id.
 */
export async function uploadMedia(args: {
  file: Blob;
  mimeType: MediaMime;
  kind: MediaKind;
  progressEntryId?: string;
}): Promise<string> {
  const { file, mimeType, kind, progressEntryId } = args;
  const { path, token } = await requestUpload({ mime_type: mimeType, size_bytes: file.size });
  await uploadToInbox(path, token, file, mimeType);
  return finalizeUpload({ inbox_path: path, kind, progress_entry_id: progressEntryId });
}

/** A short-lived signed URL to view a media object (RLS-authorized server-side). */
export async function getSignedUrl(mediaId: string): Promise<string> {
  const body = signedUrlSchema.parse({ media_id: mediaId });
  const { data, error } = await supabase.functions.invoke('media-signed-url', { body });
  if (error) throw error;
  return (data as { url: string }).url;
}

/**
 * Media owned by `ownerId`, newest first (optionally filtered by kind). RLS limits
 * results to what the caller may read (own / their coach's clients / admin).
 */
export async function listMediaFor(ownerId: string, kind?: MediaKind): Promise<Media[]> {
  let query = supabase
    .from('media')
    .select(MEDIA_COLS)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });
  if (kind) query = query.eq('kind', kind);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Media[];
}
