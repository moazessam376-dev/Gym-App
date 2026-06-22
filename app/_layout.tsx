import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
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
import { AuthProvider, useAuth } from '../src/lib/auth-context';
import { theme } from '../src/theme';

// Role-aware routing. The role comes from the verified JWT claim (server-issued
// by the access-token hook) — never from client input.
function RootNavigator() {
  const { session, role, initializing } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (initializing) return; // wait until we know whether a session exists
    const seg = segments[0];
    const inAuth = seg === '(auth)';
    const inOnboarding = seg === 'onboarding';

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
  }, [session, role, initializing, segments, router]);

  if (initializing) {
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
      <Stack.Screen name="food/add" options={{ headerShown: true, title: 'Log food' }} />
      <Stack.Screen name="food/preferences" options={{ headerShown: true, title: 'Food preferences' }} />
      <Stack.Screen name="chat/[id]" options={{ headerShown: true, title: 'Chat' }} />
      {/* Account & onboarding. */}
      <Stack.Screen name="profile" options={{ headerShown: true, title: 'Edit profile' }} />
      <Stack.Screen name="profile-setup" options={{ headerShown: true, title: 'Goals & profile' }} />
      <Stack.Screen name="become-coach" options={{ headerShown: true, title: 'Become a coach' }} />
      <Stack.Screen name="admin/applications" options={{ headerShown: true, title: 'Coach applications' }} />
    </Stack>
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
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
