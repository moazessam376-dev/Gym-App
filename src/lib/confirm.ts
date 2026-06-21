// Cross-platform destructive confirm. React Native's Alert.alert only renders a
// single-button alert on web (react-native-web maps it to window.alert), so the
// multi-button "Cancel / Delete" confirm silently does nothing there. Use the
// browser's window.confirm on web and Alert.alert on native. Resolves true if the
// user confirmed.
import { Alert, Platform } from 'react-native';

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
