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
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { readUserRole } from './jwt';
import type { Role } from '../schemas/profile';

type AuthState = {
  session: Session | null;
  /** Server-issued `user_role` claim (UX/routing only — RLS enforces the real role). */
  role: Role | null;
  initializing: boolean;
};

const AuthContext = createContext<AuthState>({
  session: null,
  role: null,
  initializing: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setInitializing(false);
    });

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

  const role = readUserRole(session?.access_token);

  return (
    <AuthContext.Provider value={{ session, role, initializing }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
