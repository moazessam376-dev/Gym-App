// Cross-platform "Save photo" for the branded transformation card (0087).
//
// Native: react-native-view-shot captureRef → the OS share sheet (expo-sharing) — on iOS
// the sheet includes "Save Image", so no photo-library permission or extra dependency is
// needed. Web: html2canvas (already in the tree as view-shot's own dependency; imported
// DIRECTLY because view-shot's web path hardcodes empty options — no useCORS — which
// silently drops cross-origin Supabase signed-URL images) → an <a download> PNG.
// The web import is dynamic so html2canvas never enters the native bundle.
import { Platform } from 'react-native';
import type { RefObject } from 'react';
import type { View } from 'react-native';

export type CaptureOutcome = 'shared' | 'downloaded' | 'failed';

const CAPTURE_BG = '#0A0B0F'; // the card's onyx — html2canvas can't see RN-web shadows

export async function captureCard(
  ref: RefObject<View | null>,
  filename: string,
): Promise<CaptureOutcome> {
  if (!ref.current) return 'failed';
  try {
    if (Platform.OS === 'web') {
      // RN-web backs a View with a real DOM node; refs expose it directly.
      const node = ref.current as unknown as HTMLElement;
      if (!node) return 'failed';
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(node, {
        useCORS: true,
        scale: 2,
        backgroundColor: CAPTURE_BG,
        logging: false,
      });
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return 'downloaded';
    }
    const { captureRef } = await import('react-native-view-shot');
    const Sharing = await import('expo-sharing');
    const uri = await captureRef(ref, { format: 'png', quality: 1 });
    if (!(await Sharing.isAvailableAsync())) return 'failed';
    await Sharing.shareAsync(uri);
    return 'shared';
  } catch {
    return 'failed';
  }
}
