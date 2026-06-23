// The app-wide TanStack Query client. It lives ABOVE the navigator
// (app/_layout.tsx) so cached reads survive screen unmount/remount — revisiting a
// tab renders its last-known data INSTANTLY instead of flashing a loader or a
// false "0" (the streak bug). It replaces the ad-hoc useFocusEffect+useState
// fetching and the tiny screen-cache Map.
//
// In-memory ONLY: query data includes sensitive health data (weights, body
// composition, names). We deliberately never persist the cache to disk (CLAUDE.md
// §7) — the cross-mount win comes from the client outliving navigation, not from
// disk. RLS + the live query remain the source of truth; this is purely a UX warm
// cache.
import { QueryClient, focusManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // data is "fresh" for 30s → quick tab hops don't refetch
      gcTime: 60 * 60_000, // keep snapshots ~1h so warm renders persist across navigation
      retry: 1,
      refetchOnReconnect: true,
      refetchOnWindowFocus: false, // no DOM window on native; AppState drives focus below
    },
  },
});

// RN equivalent of browser window-focus: mark queries focused when the app returns
// to the foreground so stale ones refetch. Subscribe once from the root layout.
export function subscribeAppStateFocus(): () => void {
  if (Platform.OS === 'web') return () => {};
  const sub = AppState.addEventListener('change', (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  });
  return () => sub.remove();
}
