import { useEffect, useRef, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootSplash } from '../src/components/BootSplash';
import { useFonts } from 'expo-font';
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  Geist_900Black,
} from '@expo-google-fonts/geist';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AuthProvider, useAuth } from '../src/lib/auth-context';
import { queryClient, subscribeAppStateFocus } from '../src/lib/query';
import { prefetchHome, useNotificationsRealtime } from '../src/lib/queries/home';
import { usePushNotifications } from '../src/lib/push';
import { loadSavedLanguage } from '../src/i18n'; // side-effect: initializes i18next
import { ToastProvider } from '../src/components/ui';
import { theme } from '../src/theme';

// Role-aware routing. The role comes from the verified JWT claim (server-issued
// by the access-token hook) — never from client input.
function RootNavigator() {
  const { t } = useTranslation();
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

  // Live notifications for the signed-in user → the home-header bell badge stays
  // current without a manual refresh (Realtime is RLS-scoped to their own rows).
  useNotificationsRealtime(userId);

  // Register this device for native push (once per user) + route a push tap to the
  // matching screen. No-op in Expo Go / web / simulator — active only on an EAS build.
  usePushNotifications(userId);

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
        // Brand screen transition: a short right-slide (auto-mirrored in RTL). Kept
        // brief so navigation feels responsive, not sluggish. Tuned in theme.motion.
        animation: theme.motion.screen,
        animationDuration: theme.motion.screenMs,
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="onboarding" />
      {/* Phase 2 sub-screens get a native header + back button. Titles localized via
          the nav namespace (also feeds the iOS back-button label). Screens that set
          their own <Stack.Screen options.title> override these — the nav key is the
          pre-mount fallback, kept localized so there's no English flash. */}
      <Stack.Screen name="coach/invite" options={{ headerShown: true, title: t('nav.inviteClient') }} />
      <Stack.Screen name="accept-invite" options={{ headerShown: true, title: t('nav.acceptInvite') }} />
      {/* Phase 3 plan screens. */}
      <Stack.Screen name="coach/client/[id]" options={{ headerShown: true, title: t('nav.clientPlans') }} />
      <Stack.Screen name="coach/templates" options={{ headerShown: true, title: t('nav.planTemplates') }} />
      <Stack.Screen name="coach/new-plan" options={{ headerShown: true, title: t('nav.newPlan') }} />
      <Stack.Screen name="coach/ai-plan" options={{ headerShown: true, title: t('nav.generatePlan') }} />
      <Stack.Screen name="coach/plan/[id]" options={{ headerShown: true, title: t('nav.plan') }} />
      <Stack.Screen name="coach/exercise-picker" options={{ headerShown: true, title: t('nav.addExercise') }} />
      <Stack.Screen name="coach/exercise/[id]" options={{ headerShown: true, title: t('nav.exercise') }} />
      <Stack.Screen name="coach/food-picker" options={{ headerShown: true, title: t('nav.addFood') }} />
      <Stack.Screen name="coach/meal-item/[id]" options={{ headerShown: true, title: t('nav.food') }} />
      <Stack.Screen name="coach/assign/[id]" options={{ headerShown: true, title: t('nav.assignToClient') }} />
      <Stack.Screen name="client/plan/[id]" options={{ headerShown: true, title: t('nav.plan') }} />
      <Stack.Screen name="client/workout/[dayId]" options={{ headerShown: true, title: t('nav.workout') }} />
      {/* Phase 11 progress & uploads. */}
      <Stack.Screen name="client/progress/weight" options={{ headerShown: true, title: t('nav.weight') }} />
      <Stack.Screen name="client/progress/photos" options={{ headerShown: true, title: t('nav.progressPhotos') }} />
      <Stack.Screen name="client/progress/inbody" options={{ headerShown: true, title: t('nav.inbodyScans') }} />
      <Stack.Screen name="client/progress/view" options={{ headerShown: true, title: '', headerTransparent: true, headerTintColor: '#fff' }} />
      {/* Phase 12a body metrics / InBody. */}
      <Stack.Screen name="client/progress/body-comp" options={{ headerShown: true, title: t('nav.bodyComposition') }} />
      <Stack.Screen name="coach/body-metric" options={{ headerShown: true, title: t('nav.newInbodyReading') }} />
      <Stack.Screen name="food/add" options={{ headerShown: true, title: t('nav.logFood') }} />
      <Stack.Screen name="food/preferences" options={{ headerShown: true, title: t('nav.foodPreferences') }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: t('nav.chat') }} />
      {/* Account & onboarding. */}
      <Stack.Screen name="profile" options={{ headerShown: true, title: t('nav.editProfile') }} />
      <Stack.Screen name="profile-setup" options={{ headerShown: true, title: t('nav.goalsProfile') }} />
      <Stack.Screen name="become-coach" options={{ headerShown: true, title: t('nav.becomeCoach') }} />
      <Stack.Screen name="settings" options={{ headerShown: true, title: t('nav.settings') }} />
      <Stack.Screen name="admin/applications" options={{ headerShown: true, title: t('nav.coachApplications') }} />
      <Stack.Screen name="admin/reports" options={{ headerShown: true, title: t('nav.reportedMessages') }} />
      <Stack.Screen name="community-guidelines" options={{ headerShown: true, title: t('nav.communityGuidelines') }} />
      {/* Phase 17 notifications. */}
      <Stack.Screen name="notifications" options={{ headerShown: true, title: t('nav.notifications') }} />
      <Stack.Screen name="notification-settings" options={{ headerShown: true, title: t('nav.notifications') }} />
      {/* Phase 19 public profiles. */}
      <Stack.Screen name="public-profile-edit" options={{ headerShown: true, title: t('nav.publicProfile') }} />
      <Stack.Screen name="coach-profile/[id]" options={{ headerShown: true, title: t('nav.coachProfile') }} />
      <Stack.Screen name="athlete-profile/[id]" options={{ headerShown: true, title: t('nav.profile') }} />
      <Stack.Screen name="discover/coaches" options={{ headerShown: true, title: t('nav.discoverCoaches') }} />
      <Stack.Screen name="leaderboards/index" options={{ headerShown: true, title: t('nav.leaderboards') }} />
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
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    Geist_900Black,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Drive TanStack Query's focus state from app foreground/background (RN has no
  // window-focus). Stale queries refetch when the app returns to the foreground.
  useEffect(() => subscribeAppStateFocus(), []);

  // Apply a saved language override (if any) BEFORE the first render, and gate paint
  // on it. RN only lays a view tree out in the right writing direction if I18nManager
  // (forceRTL) is set before that tree mounts — applying it after first render (the old
  // fire-and-forget effect) left the tab bar laid out LTR until a full native restart.
  // Gating here means every boot, including the switcher's reloadAppAsync(), paints in
  // the correct direction. loadSavedLanguage swallows its own errors and always resolves.
  const [langReady, setLangReady] = useState(false);
  useEffect(() => {
    loadSavedLanguage().finally(() => setLangReady(true));
  }, []);

  if ((!fontsLoaded && !fontError) || !langReady) {
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
          <ToastProvider>
            <RootNavigator />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
