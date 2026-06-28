// Voice notes for chat (Phase 18 + E7). Native recording uses expo-audio's hooks in the
// component (useAudioRecorder); this module owns the non-hook parts: mic permission, the
// audio-session mode (so playback routes to the SPEAKER, not the iOS earpiece), the upload
// through the SAME secure media pipeline as photos, AND a web MediaRecorder fallback
// (expo-audio's recorder is native-only).
import { Platform } from 'react-native';
import { AudioModule, setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import { uploadMedia } from './media';
import type { MediaMime } from '../schemas/media';

/** Ask for the microphone permission (and ready the audio session for recording). */
export async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return true; // getUserMedia prompts on its own
  const res = await AudioModule.requestRecordingPermissionsAsync();
  if (!res.granted) return false;
  // Allow recording + let playback work even with the ringer on silent (iOS).
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  return true;
}

/**
 * Switch the iOS audio session to PLAYBACK so a voice note plays through the SPEAKER, not
 * the earpiece. While `allowsRecording` is true the session uses the play-and-record
 * category, which routes to the receiver (E7 bug: notes played from the earpiece). Call
 * before playback. Best-effort + no-op on web.
 */
export async function setPlaybackMode(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
  } catch {
    /* best-effort */
  }
}

/**
 * Upload a finished NATIVE recording (a local file URI) as a voice note. Returns the new
 * `media` id (kind 'audio'). expo-audio records AAC-in-MP4 (.m4a → audio/mp4); the server
 * re-detects the real type from magic bytes. Reads raw bytes (a Blob uploads as 0 bytes via
 * supabase-js on RN — see src/lib/upload.ts).
 */
export async function uploadVoiceNote(uri: string): Promise<string> {
  const bytes = await new File(uri).bytes();
  const res = await uploadMedia({ file: bytes, mimeType: 'audio/mp4', kind: 'audio' });
  if ('dailyLimit' in res) throw new Error('daily_limit');
  return res.mediaId;
}

/** Upload already-read bytes (the web path produces a Blob → Uint8Array). */
export async function uploadVoiceNoteBytes(bytes: Uint8Array, mimeType: MediaMime): Promise<string> {
  const res = await uploadMedia({ file: bytes, mimeType, kind: 'audio' });
  if ('dailyLimit' in res) throw new Error('daily_limit');
  return res.mediaId;
}

// ── Web fallback (MediaRecorder) ─────────────────────────────────────────────
export type WebRecorder = {
  stop: () => Promise<{ bytes: Uint8Array; mimeType: MediaMime }>;
  cancel: () => void;
};

/** Start a web recording via MediaRecorder. webm/opus where supported, else ogg. */
export async function startWebRecording(): Promise<WebRecorder> {
  // DOM APIs only exist on web; this function is only called under Platform.OS === 'web'.
  const g = globalThis as unknown as {
    navigator: { mediaDevices: { getUserMedia: (c: unknown) => Promise<{ getTracks: () => { stop: () => void }[] }> } };
    MediaRecorder: new (s: unknown, o: unknown) => {
      start: () => void;
      stop: () => void;
      ondataavailable: (e: { data: { size: number } }) => void;
      onstop: () => void;
    } & { [k: string]: unknown };
    Blob: new (parts: unknown[], opts: unknown) => { arrayBuffer: () => Promise<ArrayBuffer>; type: string };
  };
  const MR = g.MediaRecorder as unknown as { isTypeSupported?: (t: string) => boolean } & (new (s: unknown, o: unknown) => never);
  const stream = await g.navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType: MediaMime = MR.isTypeSupported?.('audio/webm') ? 'audio/webm' : 'audio/ogg';
  const rec = new (g.MediaRecorder)(stream, { mimeType });
  const chunks: unknown[] = [];
  rec.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  rec.start();
  const cleanup = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = async () => {
          cleanup();
          const blob = new g.Blob(chunks, { type: mimeType });
          const buf = await blob.arrayBuffer();
          resolve({ bytes: new Uint8Array(buf), mimeType });
        };
        rec.stop();
      }),
    cancel: () => {
      try {
        rec.stop();
      } catch {
        /* */
      }
      cleanup();
    },
  };
}
