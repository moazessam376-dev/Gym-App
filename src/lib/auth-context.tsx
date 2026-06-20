// Auth/session state for the whole app.
//
// Holds the current Supabase session and an `initializing` flag (true until we've
// read any persisted session from SecureStore). Tokens themselves live in
// SecureStore via the adapter in `supabase.ts` (CLAUDE.md §5) — this context only
// mirrors the session into React state so screens and the route guard can react.
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type AuthState = {
  session: Session | null;
  initializing: boolean;
};

const AuthContext = createContext<AuthState>({ session: null, initializing: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let mounted = true;

    // Restore any persisted session on launch.
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setInitializing(false);
    });

    // React to sign-in / sign-out / token refresh for the life of the app.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, initializing }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
