import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootSplash } from '../src/components/BootSplash';
import { useFonts } from 'expo-font';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../src/lib/auth-context';
import { queryClient, subscribeAppStateFocus } from '../src/lib/query';
import { prefetchHome } from '../src/lib/queries/home';
import { loadSavedLanguage } from '../src/i18n'; // side-effect: initializes i18next
import { theme } from '../src/theme';

// Role-aware routing. The role comes from the verified JWT claim (server-issued
// by the access-token hook) — never from client input.
function RootNavigator() {
  const { session, role, initializing, recovering } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return; // wait until we know whether a session exists
    const seg = segments[0];
    const inAuth = seg === '(auth)';
    const inOnboarding = seg === 'onboarding';

    // A password-recovery link is active → force the set-new-password screen,
    // overriding the normal "signed-in → app" routing below.
    if (recovering) {
      const onReset = inAuth && (segments as string[])[1] === 'reset-password';
      if (!onReset) router.replace('/(auth)/reset-password');
      return;
    }

    if (!session) {
      if (!inAuth) router.replace('/(auth)/sign-in');
      return;
    }
    // Signed in but the token carries no role yet → onboarding (rare; every
    // signup is bootstrapped as 'client').
    if (!role) {
      if (!inOnboarding) router.replace('/onboarding');
      return;
    }
    // Signed in with a role → keep them out of the auth / onboarding screens.
    if (inAuth || inOnboarding) router.replace('/(tabs)');
  }, [session, role, initializing, recovering, segments, router]);

  // "Load buffer" on app open (the YouTube-style hold): warm the WHOLE cache for the
  // role and keep the branded splash up until it settles, so the user enters a
  // fully-populated app instead of watching values fill in. A timeout fail-opens so
  // a slow/hung query can never trap the user on the splash. Runs once per signed-in
  // user (a different sign-in re-boots); after this, focus-refresh + realtime keep
  // data live.
  const userId = session?.user?.id;
  const [booting, setBooting] = useState(true);
  const bootedFor = useRef<string | null>(null);
  useEffect(() => {
    if (initializing) return;
    if (!session || !role || !userId) {
      setBooting(false); // nothing to preload (signed out / no role) → enter now
      return;
    }
    const key = `${userId}:${role}`;
    if (bootedFor.current === key) return; // already warmed for this user
    bootedFor.current = key;
    setBooting(true);
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setBooting(false);
      }
    };
    const timeout = setTimeout(finish, 6000); // safety net — never hang the splash
    prefetchHome(userId, role).finally(() => {
      clearTimeout(timeout);
      finish();
    });
    return () => clearTimeout(timeout);
  }, [initializing, session, role, userId]);

  // Pre-auth (we don't yet know session/role): hold the splash; the navigator isn't
  // mounted yet, so routing can't run.
  if (initializing) return <BootSplash />;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.bg },
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontFamily: theme.fontFamily.displaySemiBold, color: theme.colors.text },
        headerShadowVisible: false,
        // Show only the back arrow — never the previous route's name (e.g. "(tabs)").
        headerBackButtonDisplayMode: 'minimal',
        headerBackTitle: '',
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="onboarding" />
      {/* Phase 2 sub-screens get a native header + back button. */}
      <Stack.Screen name="coach/invite" options={{ headerShown: true, title: 'Invite a client' }} />
      <Stack.Screen name="accept-invite" options={{ headerShown: true, title: 'Accept an invite' }} />
      {/* Phase 3 plan screens. */}
      <Stack.Screen name="coach/client/[id]" options={{ headerShown: true, title: 'Client plans' }} />
      <Stack.Screen name="coach/templates" options={{ headerShown: true, title: 'Plan templates' }} />
      <Stack.Screen name="coach/new-plan" options={{ headerShown: true, title: 'New plan' }} />
      <Stack.Screen name="coach/plan/[id]" options={{ headerShown: true, title: 'Plan' }} />
      <Stack.Screen name="coach/exercise-picker" options={{ headerShown: true, title: 'Add exercise' }} />
      <Stack.Screen name="coach/exercise/[id]" options={{ headerShown: true, title: 'Exercise' }} />
      <Stack.Screen name="coach/food-picker" options={{ headerShown: true, title: 'Add food' }} />
      <Stack.Screen name="coach/meal-item/[id]" options={{ headerShown: true, title: 'Food' }} />
      <Stack.Screen name="coach/assign/[id]" options={{ headerShown: true, title: 'Assign to client' }} />
      <Stack.Screen name="client/plan/[id]" options={{ headerShown: true, title: 'Plan' }} />
      <Stack.Screen name="client/workout/[dayId]" options={{ headerShown: true, title: 'Workout' }} />
      {/* Phase 11 progress & uploads. */}
      <Stack.Screen name="client/progress/weight" options={{ headerShown: true, title: 'Weight' }} />
      <Stack.Screen name="client/progress/photos" options={{ headerShown: true, title: 'Progress photos' }} />
      <Stack.Screen name="client/progress/inbody" options={{ headerShown: true, title: 'InBody scans' }} />
      <Stack.Screen name="client/progress/view" options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: '#fff' }} />
      {/* Phase 12a body metrics / InBody. */}
      <Stack.Screen name="client/progress/body-comp" options={{ headerShown: true, title: 'Body composition' }} />
      <Stack.Screen name="coach/body-metric" options={{ headerShown: true, title: 'New InBody reading' }} />
      <Stack.Screen name="food/add" options={{ headerShown: true, title: 'Log food' }} />
      <Stack.Screen name="food/preferences" options={{ headerShown: true, title: 'Food preferences' }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: 'Chat' }} />
      {/* Account & onboarding. */}
      <Stack.Screen name="profile" options={{ headerShown: true, title: 'Edit profile' }} />
      <Stack.Screen name="profile-setup" options={{ headerShown: true, title: 'Goals & profile' }} />
      <Stack.Screen name="become-coach" options={{ headerShown: true, title: 'Become a coach' }} />
      <Stack.Screen name="admin/applications" options={{ headerShown: true, title: 'Coach applications' }} />
    </Stack>
    {/* The navigator is mounted underneath (so routing + queries run and the cache
        warms); the splash overlays it until the prefetch settles, then fades to
        reveal a fully-populated app. */}
    {booting ? <BootSplash /> : null}
    </View>
  );
}

export default function RootLayout() {
  // Gate the app on the design-system fonts so text never flashes in the system
  // font. Family keys here MUST match src/theme/typography.ts.
  const [fontsLoaded, fontError] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Drive TanStack Query's focus state from app foreground/background (RN has no
  // window-focus). Stale queries refetch when the app returns to the foreground.
  useEffect(() => subscribeAppStateFocus(), []);

  // Apply a saved language override (if any) over the device-detected default.
  useEffect(() => {
    loadSavedLanguage();
  }, []);

  if (!fontsLoaded && !fontError) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.bg,
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
