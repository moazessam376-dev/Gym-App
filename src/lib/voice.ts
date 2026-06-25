// Voice notes for chat (Phase 18). The recording itself uses expo-audio's hooks in
// the component (useAudioRecorder); this module owns the parts that aren't hooks:
// the mic permission request and the upload of a finished recording through the SAME
// secure media pipeline as photos (signed inbox upload → magic-byte validation in
// media-finalize → service-role row insert; bytes in a private bucket, §7).
import { AudioModule, setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import { uploadMedia } from './media';

/** Ask for the microphone permission (and ready the audio session for recording). */
export async function ensureMicPermission(): Promise<boolean> {
  const res = await AudioModule.requestRecordingPermissionsAsync();
  if (!res.granted) return false;
  // Allow recording + let playback work even with the ringer on silent (iOS).
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  return true;
}

/**
 * Upload a finished recording (a local file URI from the recorder) as a voice note.
 * Returns the new `media` id (kind 'audio'). expo-audio's HIGH_QUALITY preset records
 * AAC-in-MP4 (.m4a → audio/mp4) on both platforms; the server re-detects the real type
 * from magic bytes regardless. Reads raw bytes (a Blob uploads as 0 bytes via supabase-js
 * on RN — see src/lib/upload.ts).
 */
export async function uploadVoiceNote(uri: string): Promise<string> {
  const bytes = await new File(uri).bytes();
  const res = await uploadMedia({ file: bytes, mimeType: 'audio/mp4', kind: 'audio' });
  if ('dailyLimit' in res) throw new Error('daily_limit'); // not applied to audio, but keep types honest
  return res.mediaId;
}
