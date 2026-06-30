// Coach desktop portal — the persistent shell. Wraps the WHOLE root <Stack> (mounted in
// app/_layout.tsx) so the sidebar never unmounts: tab scenes AND every pushed detail card
// render in the content region beside it. Active ONLY on wide web + coach role; for every
// other path (native, narrow web, client/admin) it's a pure pass-through, so nothing else
// in the app changes. Sets ChromeContext.active so Screen switches to its centered desktop
// layout. Boot splash / first-run tour stay OUTSIDE this wrapper (full-viewport siblings).
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useAuth } from '@/lib/auth-context';
import { useIsWideWeb } from '@/lib/useBreakpoint';
import { ChromeContext } from '@/lib/chrome';
import { theme } from '@/theme';
import { CoachSidebar } from './CoachSidebar';
import { CoachTopBar } from './CoachTopBar';

export function CoachWebChrome({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const isWide = useIsWideWeb();
  const active = isWide && role === 'coach';

  if (!active) return <>{children}</>;

  return (
    <ChromeContext.Provider value={{ active: true }}>
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.colors.bg }}>
        <CoachSidebar />
        {/* minWidth:0 stops a wide child (tables/charts) from forcing RN-Web flex overflow. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <CoachTopBar />
          <View style={{ flex: 1 }}>{children}</View>
        </View>
      </View>
    </ChromeContext.Provider>
  );
}
