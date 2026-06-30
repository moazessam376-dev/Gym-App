// Shared nav model for the coach desktop portal — consumed by CoachSidebar (the rail)
// and CoachTopBar (kicker + title). One source of truth for routes, icons, active-match,
// and the section a view belongs to.
import type { Href } from 'expo-router';
import type { IconName } from '@/components/ui';

export type NavItem = {
  key: string;
  labelKey: string;
  icon: IconName;
  route: Href;
  match: (p: string) => boolean;
  /** Adds a "soon" chip (deferred feature). */
  soon?: boolean;
  /** live count badge source. */
  badge?: 'unread' | 'invites' | 'attention';
};

export type NavSection = { titleKey: string; items: NavItem[] };

const eq = (v: string) => (p: string) => p === v;
// Exact route OR a deeper child of it ("/coach/client" matches "/coach/client/abc"),
// but NOT a sibling that merely shares the string prefix ("/profile" ≠ "/profile-setup").
const startsAny =
  (...prefixes: string[]) =>
  (p: string) =>
    prefixes.some((x) => p === x || p.startsWith(x + '/'));

export const NAV_SECTIONS: NavSection[] = [
  {
    titleKey: 'webnav.coaching',
    items: [
      { key: 'dashboard', labelKey: 'webnav.dashboard', icon: 'layout-dashboard', route: '/', match: eq('/') },
      { key: 'clients', labelKey: 'webnav.clients', icon: 'users', route: '/clients', match: startsAny('/clients', '/coach/client'), badge: 'attention' },
      { key: 'leaderboard', labelKey: 'webnav.leaderboard', icon: 'trophy', route: '/board', match: startsAny('/board', '/leaderboards') },
      { key: 'analytics', labelKey: 'webnav.analytics', icon: 'bar-chart', route: '/performance', match: startsAny('/performance') },
    ],
  },
  {
    titleKey: 'webnav.plans',
    items: [
      { key: 'templates', labelKey: 'webnav.templates', icon: 'file-text', route: '/coach/templates', match: startsAny('/coach/templates') },
      { key: 'newplan', labelKey: 'webnav.newPlan', icon: 'plus-circle', route: '/coach/new-plan', match: startsAny('/coach/new-plan', '/coach/plan', '/coach/ai-plan') },
    ],
  },
  {
    titleKey: 'webnav.communication',
    items: [
      { key: 'messages', labelKey: 'webnav.messages', icon: 'message-square', route: '/messages', match: startsAny('/messages', '/chat'), badge: 'unread' },
      { key: 'calls', labelKey: 'webnav.calls', icon: 'video', route: '/coach/calls', match: startsAny('/coach/calls'), soon: true },
    ],
  },
  {
    titleKey: 'webnav.account',
    items: [
      { key: 'profile', labelKey: 'webnav.profile', icon: 'user', route: '/public-profile-edit', match: startsAny('/public-profile-edit', '/profile') },
      { key: 'settings', labelKey: 'webnav.settings', icon: 'settings', route: '/settings', match: startsAny('/settings') },
    ],
  },
];

/** The active (section, item) for a pathname, or null if none match (e.g. a deep modal). */
export function findActive(pathname: string): { section: NavSection; item: NavItem } | null {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.match(pathname)) return { section, item };
    }
  }
  return null;
}
