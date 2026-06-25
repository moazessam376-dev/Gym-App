// Thin, safe wrapper over expo-haptics. Haptics are a native-only nicety: this
// no-ops on web (unsupported) and NEVER throws — a failed haptic must never break
// the user action it accompanies (logging a set, finishing a workout, confirming a
// delete). Import `haptics` and fire-and-forget. Wired broadly in the quality pass
// (set-complete, PR, finish, pull-to-refresh, destructive confirms).
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const native = Platform.OS === 'ios' || Platform.OS === 'android';

export const haptics = {
  /** Light selection tick — e.g. completing a set, toggling. */
  tap() {
    if (native) Haptics.selectionAsync().catch(() => {});
  },
  /** Success notification — e.g. workout finished, rest timer done, a saved record. */
  success() {
    if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  /** Warning notification — e.g. a blocked/invalid action. */
  warn() {
    if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
  /** Medium impact — e.g. a PR badge popping. */
  impact() {
    if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  },
};
