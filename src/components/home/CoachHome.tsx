// Coach "Performance Hub" — Raptor. Twin KPI tiles + top performers ranked by
// goal-relative InBody progress. No quick-action grid (it duplicated the bottom
// tabs). All data is REAL — the deeper KPI dashboard lives in the Analytics tab
// (Phase 15); the old mock activity feed has been removed.
import { View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { forwardChevron, textStart } from '@/lib/rtl';
import {
  useMyName,
  useMyClients,
  useMyInvitations,
  useRefreshOnFocus,
} from '@/lib/queries/home';
import { Icon, Screen, Text, Avatar, GlassCard, KpiTile } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { theme } from '@/theme';

export default function CoachHome() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  // Cached per-query reads → the hub renders its last-known stats instantly on
  // revisit instead of flashing zeros while the roster/board reload.
  const nameQ = useMyName(userId);
  const clientsQ = useMyClients();
  const invitesQ = useMyInvitations();

  useRefreshOnFocus(() => {
    nameQ.refetch();
    clientsQ.refetch();
    invitesQ.refetch();
  });

  const name = nameQ.data ?? null;
  const clients = clientsQ.data?.length ?? 0;
  const pending = invitesQ.data?.filter((i) => i.status === 'pending').length ?? 0;

  const go = (href: Href) => () => router.push(href);
  const pad2 = (n: number) => String(n).padStart(2, '0');

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.md, gap: theme.spacing.xl }}>
      {/* Header. The text column is content-sized (flexShrink, NOT flex:1) so
          space-between pushes the avatar to the opposite end in both LTR and RTL —
          relying on flex:1 made the avatar hug the name under RTL. textStart keeps
          the (possibly Latin) name flush to the writing-direction start. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}>
        <View style={{ flexShrink: 1 }}>
          <Text variant="label" color="primary" style={textStart}>
            {t('home.performanceHub')}
          </Text>
          <Text variant="h1" style={textStart}>
            {name ? name.split(' ')[0] : t('home.coach')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <NotificationBell />
          <Avatar name={name ?? t('home.coach')} size={48} />
        </View>
      </View>

      {/* Twin KPI tiles */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <KpiTile
          value={pad2(clients)}
          label={t('home.activeClients')}
          tone="primary"
          icon="users"
          onPress={go('/(tabs)/clients')}
        />
        <KpiTile
          value={pad2(pending)}
          label={t('home.pendingInvites')}
          tone={pending > 0 ? 'warning' : 'neutral'}
          icon="user-plus"
          onPress={go('/coach/invite')}
        />
      </View>

      {/* Top performers + the KPI dashboard now live in the dedicated Performance tab
          (Slice G1 merged Ranks + Analytics + this card into one place). */}
      <GlassCard onPress={go('/(tabs)/performance')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <Icon name="bar-chart" size={22} color={theme.colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" style={textStart}>
              {t('home.viewPerformance')}
            </Text>
            <Text variant="caption" muted style={textStart}>
              {t('home.viewPerformanceSub')}
            </Text>
          </View>
          <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
        </View>
      </GlassCard>
    </Screen>
  );
}
