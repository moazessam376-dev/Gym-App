// On-device half of the secure media pipeline (foundations §5). The app NEVER writes
// the `media` row — it only produces sanitized JPEG bytes and hands them to
// src/lib/media.ts, which drives the three Edge Functions (signed inbox upload →
// EXIF-strip + magic-byte validation in media-finalize → row insert by service role).
//
// Here we: ask permission → pick from camera or library → downscale + re-encode to
// JPEG (this converts HEIC→JPEG AND drops EXIF on-device as defense-in-depth; the
// server strips again regardless) → read the file as raw bytes (a Blob uploads as 0
// bytes through supabase-js on RN) → uploadMedia.
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { uploadMedia } from './media';
import type { MediaKind } from '../schemas/media';

export type PickSource = 'camera' | 'library';

// Long edge cap + JPEG quality for uploaded photos. Big enough to read an InBody
// sheet / see physique detail, small enough to stay well under the 10 MB server cap.
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

/** True if the user granted (or already had) the permission for this source. */
async function ensurePermission(source: PickSource): Promise<boolean> {
  const res =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  return res.granted;
}

export type UploadResult = { mediaId: string } | { cancelled: true } | { denied: true };

/**
 * Capture/pick a photo and upload it as `kind`. Returns the new media id, or a
 * `cancelled`/`denied` marker so the caller can message appropriately. Throws only
 * on a genuine upload/network failure (caller shows a generic error).
 */
export async function captureAndUploadPhoto(args: {
  source: PickSource;
  kind: MediaKind;
}): Promise<UploadResult> {
  const { source, kind } = args;

  if (!(await ensurePermission(source))) return { denied: true };

  const picked =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 1, // we re-compress below; keep the capture lossless
          exif: false,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 1,
          exif: false,
        });

  if (picked.canceled || picked.assets.length === 0) return { cancelled: true };
  const asset = picked.assets[0]!;

  // Downscale (long edge ≤ MAX_EDGE) + re-encode to JPEG. Resizing only by width
  // keeps the aspect ratio; we cap whichever edge is longer.
  const resize =
    (asset.width ?? 0) >= (asset.height ?? 0)
      ? { width: MAX_EDGE }
      : { height: MAX_EDGE };
  const out = await manipulateAsync(asset.uri, [{ resize }], {
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });

  // Read the sanitized file as raw bytes. On React Native a Blob/File uploads as 0
  // bytes through supabase-js, so we pass a Uint8Array (its documented RN path).
  const bytes = await new File(out.uri).bytes();

  const mediaId = await uploadMedia({ file: bytes, mimeType: 'image/jpeg', kind });
  return { mediaId };
}
