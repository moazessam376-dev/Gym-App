// Small, NON-sensitive key/value preferences (e.g. the chosen UI language). Mirrors
// the SecureStore(native)/localStorage(web) split that supabase.ts uses for the
// session, but for plain settings — never store secrets or tokens here.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export async function getPref(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  }
  return SecureStore.getItemAsync(key);
}

export async function setPref(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}
