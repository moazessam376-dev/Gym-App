// Coach "Performance Hub" — Neon Glassy Dark (blue family). Twin stat hero + top
// performers ranked by goal-relative InBody progress. No quick-action grid (it
// duplicated the bottom tabs). All data is REAL — the deeper KPI dashboard lives in
// the Analytics tab (Phase 15); the old mock activity feed has been removed.
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { forwardChevron, textStart } from '@/lib/rtl';
import {
  useMyName,
  useMyClients,
  useMyInvitations,
  useBodyMetricsBoard,
  useRefreshOnFocus,
} from '@/lib/queries/home';
import { Icon, Screen, Text, Avatar, GlassCard, StatBlock, EmptyState } from '@/components/ui';
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
  const boardQ = useBodyMetricsBoard();

  useRefreshOnFocus(() => {
    nameQ.refetch();
    clientsQ.refetch();
    invitesQ.refetch();
    boardQ.refetch();
  });

  const name = nameQ.data ?? null;
  const clients = clientsQ.data?.length ?? 0;
  const pending = invitesQ.data?.filter((i) => i.status === 'pending').length ?? 0;
  const board = boardQ.data ?? [];

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

      {/* Twin hero stats */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <LinearGradient
          colors={theme.gradients.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flex: 1,
            borderRadius: theme.radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
            padding: theme.spacing.lg,
          }}
        >
          <StatBlock value={pad2(clients)} label={t('home.activeClients')} valueColor={theme.colors.primary} />
        </LinearGradient>
        <View
          style={{
            flex: 1,
            backgroundColor: theme.colors.glass,
            borderRadius: theme.radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
            padding: theme.spacing.lg,
          }}
        >
          <StatBlock
            value={pad2(pending)}
            label={t('home.pendingInvites')}
            valueColor={pending > 0 ? theme.colors.warning : theme.colors.text}
          />
        </View>
      </View>

      {/* Top performers — REAL, ranked by goal-relative InBody progress (0026) */}
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="label" muted>
          {t('home.topPerformers')}
        </Text>

        {board.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            title={t('home.noReadingsTitle')}
            subtitle={t('home.noReadingsSub')}
          />
        ) : (
          board.map((r) => (
            <GlassCard
              key={r.client_id}
              glowColor={r.rank === 1 && r.progress.hasTrend ? theme.colors.primary : undefined}
              onPress={() =>
                router.push({ pathname: '/coach/client/[id]', params: { id: r.client_id, name: r.full_name ?? '' } })
              }
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Text
                  variant="title"
                  color={r.rank === 1 ? theme.colors.primary : theme.colors.textMuted}
                  style={{ width: 18 }}
                >
                  {r.rank}
                </Text>
                <Avatar name={r.full_name ?? t('home.client')} size={40} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{r.full_name ?? t('home.client')}</Text>
                  <Text variant="caption" color={r.progress.hasTrend ? 'primary' : theme.colors.textMuted}>
                    {r.progress.headline}
                  </Text>
                </View>
                <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
              </View>
            </GlassCard>
          ))
        )}
      </View>
    </Screen>
  );
}
