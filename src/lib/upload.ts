// On-device half of the secure media pipeline (foundations §5). The app NEVER writes
// the `media` row — it only produces sanitized JPEG bytes and hands them to
// src/lib/media.ts, which drives the three Edge Functions (signed inbox upload →
// EXIF-strip + magic-byte validation in media-finalize → row insert by service role).
//
// Here we: ask permission → pick from camera or library → downscale + re-encode to
// JPEG (this converts HEIC→JPEG AND drops EXIF on-device as defense-in-depth; the
// server strips again regardless) → read the file as raw bytes (a Blob uploads as 0
// bytes through supabase-js on RN) → uploadMedia.
import { Platform } from 'react-native';
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

export type UploadResult =
  | { mediaId: string }
  | { cancelled: true }
  | { denied: true }
  | { limited: 'daily' };

/**
 * Capture/pick a photo and upload it as `kind`. Returns the new media id, or a
 * `cancelled`/`denied` marker so the caller can message appropriately. Throws only
 * on a genuine upload/network failure (caller shows a generic error).
 */
export async function captureAndUploadPhoto(args: {
  source: PickSource;
  kind: MediaKind;
  /**
   * Open the native crop/zoom editor with a SQUARE (1:1) frame — the WhatsApp-style
   * "move & scale" UI for avatars. Off for progress photos / InBody (those must keep
   * their full frame, never get cropped to a square).
   */
  squareCrop?: boolean;
}): Promise<UploadResult> {
  const { source, kind, squareCrop = false } = args;

  if (!(await ensurePermission(source))) return { denied: true };

  // allowsEditing turns on the platform crop UI; aspect [1,1] makes it a square avatar
  // frame the user can pan & pinch-zoom within before confirming.
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1, // we re-compress below; keep the capture lossless
    exif: false,
    allowsEditing: squareCrop,
    ...(squareCrop ? { aspect: [1, 1] } : null),
  };

  const picked =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

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
  // expo-file-system's File is NATIVE-only — on web the manipulator returns a
  // blob:/data: URL, which fetch() reads directly.
  const bytes =
    Platform.OS === 'web'
      ? new Uint8Array(await (await fetch(out.uri)).arrayBuffer())
      : await new File(out.uri).bytes();

  const res = await uploadMedia({ file: bytes, mimeType: 'image/jpeg', kind });
  if ('dailyLimit' in res) return { limited: 'daily' };
  return { mediaId: res.mediaId };
}

/**
 * Pick/capture + upload an `avatar` photo (square-cropped, EXIF-stripped + magic-byte
 * validated server-side like every other upload). Returns the new media id — but does
 * NOT link it to the profile. The editor holds the id locally for preview and persists
 * the link (setMyAvatar) only when the user taps Save, so the photo behaves like the
 * rest of the form (nothing saves until Save).
 */
export async function pickAvatar(source: PickSource): Promise<UploadResult> {
  // squareCrop: let the user frame (pan + zoom) a 1:1 avatar like WhatsApp.
  return captureAndUploadPhoto({ source, kind: 'avatar', squareCrop: true });
}
