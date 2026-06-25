// Full native app restart.
//
// Applying an I18nManager.forceRTL change on Android needs the native Activity to be
// recreated: a JS-only reload (expo's reloadAppAsync) re-runs the bundle but does NOT
// recreate the Activity, so the native layout direction — e.g. the bottom tab-bar
// order — only flips on the next cold start. react-native-restart triggers a real
// native restart, which applies the direction immediately. If that native module is
// somehow unavailable at runtime (e.g. Expo Go), we fall back to reloadAppAsync so the
// switch still takes effect on the next launch (the boot gate re-applies the saved
// direction) — no regression versus the previous behavior.
import { reloadAppAsync } from 'expo';
import RNRestart from 'react-native-restart';

export async function restartApp(): Promise<void> {
  try {
    RNRestart.restart();
  } catch {
    await reloadAppAsync();
  }
}
