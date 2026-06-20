// Supabase client for the Expo app.
//
// Uses the PUBLIC anon key only. The service-role key must never appear in
// client code (CLAUDE.md §3, §12) — RLS is what keeps the anon key safe.
import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Auth tokens must live in the device Keychain/Keystore via SecureStore, never
// AsyncStorage/plain SQLite (CLAUDE.md §5). SecureStore is native-only, so the
// web build falls back to localStorage (the browser has no Keychain).
//
// SecureStore warns/fails past ~2KB per value, and a Supabase session (JWT +
// refresh token + user) now exceeds that. So we chunk the value across multiple
// Keychain entries — `key` holds the chunk count, `key.0`/`key.1`/… hold the
// pieces. Everything stays in the Keychain; nothing touches AsyncStorage (§5).
const SECURE_STORE_CHUNK = 2000; // safely under SecureStore's ~2KB ceiling

const secureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    const head = await SecureStore.getItemAsync(key);
    if (head === null) return null;
    // A non-numeric head is a legacy single-value write (e.g. JSON) — return it.
    if (!/^\d+$/.test(head)) return head;
    const count = Number(head);
    let value = '';
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part === null) return null; // a missing chunk = corrupt → force re-auth
      value += part;
    }
    return value;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    const prevHead = await SecureStore.getItemAsync(key);
    const prevCount = prevHead && /^\d+$/.test(prevHead) ? Number(prevHead) : 0;
    const count = Math.ceil(value.length / SECURE_STORE_CHUNK);
    await SecureStore.setItemAsync(key, String(count));
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(
        `${key}.${i}`,
        value.slice(i * SECURE_STORE_CHUNK, (i + 1) * SECURE_STORE_CHUNK),
      );
    }
    // Drop any leftover chunks from a previously larger value.
    for (let i = count; i < prevCount; i++) {
      await SecureStore.deleteItemAsync(`${key}.${i}`);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    const head = await SecureStore.getItemAsync(key);
    const count = head && /^\d+$/.test(head) ? Number(head) : 0;
    await SecureStore.deleteItemAsync(key);
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(`${key}.${i}`);
    }
  },
};

const webStorageAdapter = {
  getItem: async (key: string) =>
    typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null,
  setItem: async (key: string, value: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  },
};

const storage = Platform.OS === 'web' ? webStorageAdapter : secureStoreAdapter;

// EXPO_PUBLIC_* vars are inlined into the client bundle by Expo — public by design.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Generic message — never echo the values themselves.
  console.warn('Supabase is not configured. Copy .env.example to .env and set EXPO_PUBLIC_* vars.');
}

export const supabase: SupabaseClient = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    // Only relevant for the web OAuth redirect flow.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
