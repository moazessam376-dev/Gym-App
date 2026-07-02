// Coach desktop portal — left sidebar nav. Mounted once by CoachWebChrome (wide web +
// coach role only), so it persists across every route (tab routes AND root-stack detail
// screens). Navigation is `router.navigate` for both classes (dedupes; pops the root
// stack back to a tab when a detail was open). Active state is derived from a single
// `usePathname()` + per-item prefix match. RTL-aware via flexDirection:'row' (the rail
// mirrors to the right in Arabic) + logical border.
import { Pressable, ScrollView, View } from 'react-native';
import { I18nManager } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { useMyName, useMyInvitations, useConversationPreviews, useCoachAdherence } from '@/lib/queries/home';
import { usePendingSubmissions } from '@/lib/queries/transformations';
import { needsAttention } from '@/lib/analytics';
import { SIDEBAR_WIDTH } from '@/lib/useBreakpoint';
import { Avatar, Badge, Icon, Text, type IconName } from '@/components/ui';
import { theme } from '@/theme';
import { NAV_SECTIONS } from './nav-model';

function NavRow({
  label,
  icon,
  active,
  soonLabel,
  badgeCount,
  badgeTone = 'primary',
  onPress,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  soonLabel?: string;
  badgeCount?: number;
  badgeTone?: 'primary' | 'danger';
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.sm + 2,
        paddingHorizontal: theme.spacing.md,
        marginHorizontal: theme.spacing.sm,
        borderRadius: theme.radii.md,
        // Active = a filled cyan-tinted rounded block (design), not a left-border accent.
        backgroundColor: active
          ? 'rgba(63,217,192,0.12)'
          : pressed
            ? theme.colors.surfaceElevated
            : 'transparent',
      })}
    >
      <Icon name={icon} size={18} color={active ? theme.colors.primary : theme.colors.textMuted} />
      <Text
        variant="bodyStrong"
        color={active ? theme.colors.primary : theme.colors.textMuted}
        style={{ flex: 1, textAlign: I18nManager.isRTL ? 'right' : 'left' }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {soonLabel ? <Badge label={soonLabel} tone="neutral" /> : null}
      {badgeCount ? <Badge label={String(badgeCount)} tone={badgeTone} solid /> : null}
    </Pressable>
  );
}

export function CoachSidebar() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const nameQ = useMyName(session?.user?.id);
  const invitesQ = useMyInvitations();
  const previewsQ = useConversationPreviews();
  const adherenceQ = useCoachAdherence();
  const submissionsQ = usePendingSubmissions(session?.user?.id);

  const name = nameQ.data ?? null;
  const pendingInvites = invitesQ.data?.filter((i) => i.status === 'pending').length ?? 0;
  const unread = (previewsQ.data ?? []).reduce((a, c) => a + c.unread_count, 0);
  const attention = needsAttention(adherenceQ.data ?? []).length;
  const submissions = submissionsQ.data?.length ?? 0;

  const counts: Record<string, number> = { unread, invites: pendingInvites, attention, submissions };

  return (
    <View
      style={{
        width: SIDEBAR_WIDTH,
        height: '100%',
        backgroundColor: theme.colors.surface,
        borderEndWidth: 1,
        borderEndColor: theme.colors.border,
      }}
    >
      {/* Brand */}
      <View style={{ paddingVertical: theme.spacing.xl, paddingHorizontal: theme.spacing.lg, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: theme.radii.sm,
              backgroundColor: theme.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="bodyStrong" color={theme.colors.onPrimary}>
              R
            </Text>
          </View>
          <Text variant="h2">{t('webnav.brand')}</Text>
        </View>
        <Text variant="label" muted style={{ textAlign: I18nManager.isRTL ? 'right' : 'left' }}>
          {t('webnav.brandTagline')}
        </Text>
      </View>

      {/* Nav */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {NAV_SECTIONS.map((section) => (
          <View key={section.titleKey} style={{ marginBottom: theme.spacing.lg }}>
            <Text
              variant="label"
              muted
              style={{ paddingHorizontal: theme.spacing.lg, marginBottom: theme.spacing.xs, textAlign: I18nManager.isRTL ? 'right' : 'left' }}
            >
              {t(section.titleKey)}
            </Text>
            {section.items.map((item) => (
              <NavRow
                key={item.key}
                label={t(item.labelKey)}
                icon={item.icon}
                active={item.match(pathname)}
                soonLabel={item.soon ? t('webnav.soon') : undefined}
                badgeCount={item.badge ? counts[item.badge] : undefined}
                badgeTone={item.badge === 'attention' ? 'danger' : 'primary'}
                onPress={() => router.navigate(item.route)}
              />
            ))}
          </View>
        ))}
      </ScrollView>

      {/* Footer — coach identity → Account */}
      <Pressable
        onPress={() => router.navigate('/account')}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <Avatar name={name ?? t('webnav.coachRole')} size={36} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ textAlign: I18nManager.isRTL ? 'right' : 'left' }}>
            {name ?? t('webnav.coachRole')}
          </Text>
          <Text variant="caption" muted numberOfLines={1} style={{ textAlign: I18nManager.isRTL ? 'right' : 'left' }}>
            {t('webnav.coachRole')}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
