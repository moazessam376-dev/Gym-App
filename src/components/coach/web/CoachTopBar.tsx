// Coach desktop portal — top bar. Page kicker (section) + title (active view) derived
// from the same nav model as the sidebar, a search field (visual-only in W0; wired to
// real search later), and the coach avatar → Account. Mounted by CoachWebChrome only on
// wide web + coach role.
import { I18nManager, Pressable, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { useMyName } from '@/lib/queries/home';
import { TOPBAR_HEIGHT } from '@/lib/useBreakpoint';
import { Avatar, Icon, Text } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { theme } from '@/theme';
import { findActive } from './nav-model';

export function CoachTopBar() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const nameQ = useMyName(session?.user?.id);
  const name = nameQ.data ?? null;

  const active = findActive(pathname);
  const kicker = active ? t(active.section.titleKey) : t('webnav.coaching');
  const title = active ? t(active.item.labelKey) : t('webnav.dashboard');
  const align = I18nManager.isRTL ? ('right' as const) : ('left' as const);

  return (
    <View
      style={{
        height: TOPBAR_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.lg,
        paddingHorizontal: theme.spacing.xl,
        backgroundColor: theme.colors.bg,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <View style={{ flexShrink: 1 }}>
        <Text variant="label" color="primary" style={{ textAlign: align }}>
          {kicker}
        </Text>
        <Text variant="h2" numberOfLines={1} style={{ textAlign: align }}>
          {title}
        </Text>
      </View>

      <View style={{ flex: 1 }} />

      {/* Search — visual affordance for now (wired to client/plan search later). */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.sm,
          paddingHorizontal: theme.spacing.md,
          height: 38,
          width: 260,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        <Icon name="search" size={16} color={theme.colors.textMuted} />
        <Text variant="caption" muted numberOfLines={1} style={{ flex: 1, textAlign: align }}>
          {t('webnav.searchPlaceholder')}
        </Text>
      </View>

      {/* Notifications — the desktop shell's only access point (no bottom bar / Home bell). */}
      <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
        <NotificationBell />
      </View>

      <Pressable onPress={() => router.navigate('/account')}>
        <Avatar name={name ?? t('webnav.coachRole')} size={38} />
      </Pressable>
    </View>
  );
}
