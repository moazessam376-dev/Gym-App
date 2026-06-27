// Warn before leaving a screen that has unsaved edits. When `dirty` is true and the
// user tries to navigate away (swipe-back / header back / Android hardware back), they
// get a confirm; on "discard" we proceed with the original navigation action, otherwise
// we stay put. Built on React Navigation's usePreventRemove (available through
// expo-router). Copy is passed in already-translated so it works in EN and AR.
import { useNavigation } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { confirm } from './confirm';

export type UnsavedGuardCopy = {
  title: string;
  message: string;
  /** Confirm label — leave & lose the edits. */
  discard: string;
  /** Cancel label — stay on the screen. */
  keep: string;
};

export function useUnsavedGuard(dirty: boolean, copy: UnsavedGuardCopy) {
  const navigation = useNavigation();
  usePreventRemove(dirty, ({ data }) => {
    confirm(copy.title, copy.message, copy.discard, copy.keep).then((ok) => {
      if (ok) navigation.dispatch(data.action);
    });
  });
}
