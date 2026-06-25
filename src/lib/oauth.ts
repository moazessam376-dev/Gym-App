// Social sign-in (Phase 14d "launch auth"). Google OAuth through Supabase Auth — we
// never hand-roll token handling (CLAUDE.md §5). The client uses the PKCE flow, so
// the provider returns a one-time `code` we exchange for a session.
//
//   • Web: supabase-js does a full-page redirect; detectSessionInUrl (supabase.ts)
//     completes the session on return.
//   • Native: open the system browser with expo-web-browser, capture the redirect
//     back to our scheme, and exchange the code. The code_verifier was stored in
//     SecureStore when the flow started, so the exchange happens on-device.
//
// To enable: create a Google Cloud OAuth client, turn the Google provider on in
// Supabase, and add the app's redirect (raptor:// …) to Auth → URL Configuration.
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { createURL, parse } from 'expo-linking';
import { supabase } from './supabase';

// Required on web so a returning auth popup/redirect can settle. No-op on native.
WebBrowser.maybeCompleteAuthSession();

export type OAuthResult = { ok: true } | { ok: false; cancelled?: boolean };

/** Begin Google sign-in. Resolves once a session exists (native) or the redirect is
 *  kicked off (web). Generic failures only — never surface provider internals (§4). */
export async function signInWithGoogle(): Promise<OAuthResult> {
  const redirectTo = createURL('/');

  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    return error ? { ok: false } : { ok: true };
  }

  // Native: get the provider URL but DON'T let supabase-js try to open it.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return { ok: false };

  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success' || !res.url) {
    return { ok: false, cancelled: res.type === 'cancel' || res.type === 'dismiss' };
  }

  const { queryParams } = parse(res.url);
  const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
  if (!code) return { ok: false };

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  return exchangeError ? { ok: false } : { ok: true };
}
