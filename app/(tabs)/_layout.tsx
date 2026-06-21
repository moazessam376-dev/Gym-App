// Role-based bottom tabs. ONE shared group renders a different tab set per role
// (read from the verified JWT via useAuth) — coach / client / admin each see only
// their tabs; the rest are hidden with `href: null`. Deep editor/detail screens
// stay in the ROOT stack (app/_layout.tsx) so router.push slides them full-screen
// over the tab bar. The redirect guard already blocks roleless users, so role is
// resolved before this layout mounts (no flicker).
import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { theme } from '../../src/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(active: IconName, inactive: IconName) {
  return ({ color, focused, size }: { color: string; focused: boolean; size: number }) => (
    <Ionicons name={focused ? active : inactive} size={size} color={color} />
  );
}

export default function TabsLayout() {
  const { role } = useAuth();
  const isClient = role === 'client';
  const isCoach = role === 'coach';
  const isAdmin = role === 'admin';

  // `href: null` keeps the route available (deep links / programmatic nav) but
  // removes it from the bar for roles that shouldn't see it.
  const showFor = (visible: boolean) => (visible ? undefined : null);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontFamily: theme.fontFamily.bodySemiBold,
          fontSize: 11,
        },
        sceneStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: tabIcon('home', 'home-outline') }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: 'Plans',
          href: showFor(isClient),
          tabBarIcon: tabIcon('barbell', 'barbell-outline'),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          href: showFor(isClient),
          tabBarIcon: tabIcon('trending-up', 'trending-up-outline'),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: 'Clients',
          href: showFor(isCoach),
          tabBarIcon: tabIcon('people', 'people-outline'),
        }}
      />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: 'Ranks',
          href: showFor(isCoach),
          tabBarIcon: tabIcon('trophy', 'trophy-outline'),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Chat',
          href: showFor(isClient || isCoach),
          tabBarIcon: tabIcon('chatbubbles', 'chatbubbles-outline'),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: tabIcon('person-circle', 'person-circle-outline'),
        }}
      />
    </Tabs>
  );
}
