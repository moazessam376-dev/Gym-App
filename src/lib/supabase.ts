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
// Note: SecureStore values are capped at ~2KB; Supabase session tokens fit
// today. If a session ever exceeds that, switch to a chunking adapter.
const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
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

// Inert placeholders when env is missing so the client constructs without
// throwing at import; calls then fail into a handled, generic error instead of
// crashing the app (e.g. before .env is created).
export const supabase: SupabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      // Only relevant for the web OAuth redirect flow.
      detectSessionInUrl: Platform.OS === 'web',
    },
  },
);
