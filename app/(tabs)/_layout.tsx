// Role-based bottom tabs. ONE shared group renders a different tab set per role
// (read from the verified JWT via useAuth) — coach / client / admin each see only
// their tabs; the rest are hidden with `href: null`. Deep editor/detail screens
// stay in the ROOT stack (app/_layout.tsx) so router.push slides them full-screen
// over the tab bar. The redirect guard already blocks roleless users, so role is
// resolved before this layout mounts (no flicker).
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { useIsWideWeb } from '../../src/lib/useBreakpoint';
import { theme } from '../../src/theme';
import { Icon, type IconName } from '../../src/components/ui';

// One line-icon per tab — active state is the cyan tint, not a filled variant
// (the brand uses a single line set, no filled/outline pairs).
function tabIcon(name: IconName) {
  return ({ color, size }: { color: string; focused: boolean; size: number }) => (
    <Icon name={name} size={size} color={color} />
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const isClient = role === 'client';
  const isCoach = role === 'coach';
  const isAdmin = role === 'admin';

  // On wide WEB the coach gets the desktop sidebar shell (CoachWebChrome), so the bottom
  // bar is suppressed — the sidebar drives navigation. Every <Tabs.Screen> stays
  // registered (incl. the href:null `clients`), so all tab routes remain navigable from
  // the sidebar. Native / phone-web / client / admin keep the bar exactly as today.
  const hideTabBar = useIsWideWeb() && isCoach;

  // `href: null` keeps the route available (deep links / programmatic nav) but
  // removes it from the bar for roles that shouldn't see it.
  const showFor = (visible: boolean) => (visible ? undefined : null);

  // Eagerly mount the tabs this role actually sees (lazy:false) so they're built +
  // populated UNDER the boot splash — the first tap shows an already-rendered screen
  // instead of constructing it in front of you. Hidden cross-role tabs stay lazy
  // (default), so they never mount (and can't fire a cross-role <Redirect>).
  const eager = (visible: boolean) => !visible;

  return (
    <Tabs
      tabBar={hideTabBar ? () => null : undefined}
      screenOptions={{
        headerShown: false,
        // Subtle cross-shift when switching tabs (native). On WEB, switch instantly — a
        // dashboard shouldn't animate between sidebar sections (reads as lag).
        animation: Platform.OS === 'web' ? 'none' : theme.motion.tab,
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
        options={{ title: t('tabs.home'), lazy: false, tabBarIcon: tabIcon('home') }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: t('tabs.plans'),
          href: showFor(isClient),
          lazy: eager(isClient),
          tabBarIcon: tabIcon('dumbbell'),
        }}
      />
      <Tabs.Screen
        name="nutrition"
        options={{
          title: t('tabs.nutrition'),
          href: showFor(isClient),
          lazy: eager(isClient),
          tabBarIcon: tabIcon('salad'),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: t('tabs.progress'),
          href: showFor(isClient),
          lazy: eager(isClient),
          tabBarIcon: tabIcon('trending-up'),
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: t('tabs.clients'),
          // Demoted from the coach bottom bar (U-1): the route stays reachable via the
          // CoachHome "Active Clients" KPI tile + deep links, but it no longer competes
          // with Chat for a bar slot (it looked like the Chat tab). Coach bar is now
          // Home · Performance · Chat · Account.
          href: null,
          tabBarIcon: tabIcon('users'),
        }}
      />
      <Tabs.Screen
        name="performance"
        options={{
          title: t('tabs.performance'),
          href: showFor(isCoach),
          lazy: eager(isCoach),
          tabBarIcon: tabIcon('bar-chart'),
        }}
      />
      <Tabs.Screen
        name="board"
        options={{
          // Leaderboard is a coach bottom-tab (it used to be a Home-header trophy). Clients
          // still reach the boards via the standalone /leaderboards route (Home trophy), so
          // this tab is coach-only. Coach bar: Home · Performance · Leaderboard · Chat.
          title: t('tabs.leaderboard'),
          href: showFor(isCoach),
          lazy: eager(isCoach),
          tabBarIcon: tabIcon('trophy-outline'),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('tabs.chat'),
          href: showFor(isClient || isCoach),
          lazy: eager(isClient || isCoach),
          tabBarIcon: tabIcon('message-square'),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('tabs.account'),
          // Clients AND coaches reach Account from the Home header avatar; only admin keeps
          // it as a bottom tab. (Client bar stays five; coach bar frees a slot for the
          // Leaderboard tab above.)
          href: showFor(isAdmin),
          lazy: eager(isAdmin),
          tabBarIcon: tabIcon('user'),
        }}
      />
    </Tabs>
  );
}
