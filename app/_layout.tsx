import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/lib/auth-context';

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
    if (inAuth || inOnboarding) router.replace('/');
  }, [session, role, initializing, segments, router]);

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="onboarding" />
      {/* Phase 2 sub-screens get a native header + back button. */}
      <Stack.Screen name="coach/roster" options={{ headerShown: true, title: 'My clients' }} />
      <Stack.Screen name="coach/invite" options={{ headerShown: true, title: 'Invite a client' }} />
      <Stack.Screen name="accept-invite" options={{ headerShown: true, title: 'Accept an invite' }} />
      {/* Phase 3 plan screens. */}
      <Stack.Screen name="coach/client/[id]" options={{ headerShown: true, title: 'Client plans' }} />
      <Stack.Screen name="coach/templates" options={{ headerShown: true, title: 'Plan templates' }} />
      <Stack.Screen name="coach/plan/[id]" options={{ headerShown: true, title: 'Plan' }} />
      <Stack.Screen name="coach/exercise-picker" options={{ headerShown: true, title: 'Add exercise' }} />
      <Stack.Screen name="coach/exercise/[id]" options={{ headerShown: true, title: 'Exercise' }} />
      <Stack.Screen name="coach/food-picker" options={{ headerShown: true, title: 'Add food' }} />
      <Stack.Screen name="coach/meal-item/[id]" options={{ headerShown: true, title: 'Food' }} />
      <Stack.Screen name="coach/assign/[id]" options={{ headerShown: true, title: 'Assign to client' }} />
      <Stack.Screen name="client/plans" options={{ headerShown: true, title: 'My plans' }} />
      <Stack.Screen name="client/plan/[id]" options={{ headerShown: true, title: 'Plan' }} />
      {/* Account & onboarding. */}
      <Stack.Screen name="profile" options={{ headerShown: true, title: 'Edit profile' }} />
      <Stack.Screen name="become-coach" options={{ headerShown: true, title: 'Become a coach' }} />
      <Stack.Screen name="admin/applications" options={{ headerShown: true, title: 'Coach applications' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
