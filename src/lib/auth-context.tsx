// Auth/session state for the whole app.
//
// Holds the current Supabase session, the role from its verified JWT claim, and
// an `initializing` flag (true until any persisted session is read from
// SecureStore). Tokens live in SecureStore via the adapter in `supabase.ts`
// (CLAUDE.md §5); this context only mirrors session + role into React state.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { queryClient } from './query';
import { readUserRole } from './jwt';
import type { Role } from '../schemas/profile';

type AuthState = {
  session: Session | null;
  /** Server-issued `user_role` claim (UX/routing only — RLS enforces the real role). */
  role: Role | null;
  initializing: boolean;
  /** True while a password-recovery link session is active — the root guard routes to
   * the set-new-password screen instead of the app. Cleared on sign-out. */
  recovering: boolean;
};

const AuthContext = createContext<AuthState>({
  session: null,
  role: null,
  initializing: true,
  recovering: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setInitializing(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      // A recovery link establishes a temporary session — flag it so the root guard
      // sends the user to set-a-new-password instead of into the app.
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      // Drop every cached query on sign-out so the next account can't see warm
      // data from the previous one (the cache is keyed per user, but clearing is
      // the belt-and-suspenders guarantee).
      if (event === 'SIGNED_OUT') {
        setRecovering(false);
        queryClient.clear();
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // Native password-reset deep link. On web, detectSessionInUrl (supabase.ts) handles
  // the recovery link and fires PASSWORD_RECOVERY automatically; on native it's off, so
  // we parse the raptor://reset-password?code=… link ourselves, exchange the PKCE code
  // for a session, and flag recovery so the root guard shows the set-new-password screen.
  // (OAuth redirects use a different path and are handled in src/lib/oauth.ts.)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    const handle = async (url: string | null) => {
      if (!url) return;
      const { path, queryParams } = Linking.parse(url);
      const isRecovery = (path ?? '').includes('reset-password') || queryParams?.type === 'recovery';
      if (!isRecovery) return;
      const code = typeof queryParams?.code === 'string' ? queryParams.code : null;
      if (!code) return;
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (active && !error) setRecovering(true);
    };
    Linking.getInitialURL().then(handle); // cold start (app opened by the link)
    const sub = Linking.addEventListener('url', (e) => handle(e.url)); // warm
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const role = readUserRole(session?.access_token);

  return (
    <AuthContext.Provider value={{ session, role, initializing, recovering }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
