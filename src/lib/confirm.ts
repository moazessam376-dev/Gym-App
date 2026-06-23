// Cross-platform destructive confirm. React Native's Alert.alert only renders a
// single-button alert on web (react-native-web maps it to window.alert), so the
// multi-button "Cancel / Delete" confirm silently does nothing there. Use the
// browser's window.confirm on web and Alert.alert on native. Resolves true if the
// user confirmed.
import { Alert, Platform } from 'react-native';

/** Non-destructive two-button confirm (e.g. "restart to apply Arabic"). Labels are
 * passed in so they can be translated. Resolves true if the user confirmed. */
export function confirm(
  title: string,
  message: string,
  confirmLabel: string,
  cancelLabel: string,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`);
    return Promise.resolve(!!ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, onPress: () => resolve(true) },
    ]);
  });
}

export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel = 'Delete',
): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`);
    return Promise.resolve(!!ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
