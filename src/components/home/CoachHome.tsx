// Coach "Performance Hub" — Raptor. A live, glanceable home: KPI grid (clients /
// invites / roster adherence / unread messages) → "Needs attention" (clients who are
// quiet or off-track, powered by absence so it's populated even with no InBody data) →
// top performers (graceful fallback to "recently active") → an optional AI insight.
// All from already-prefetched coach hooks — no new SQL. The deep KPI dashboard lives
// in the Performance tab (Slice G1); this is the at-a-glance "what do I do now?" view.
import { Pressable, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { forwardChevron, textStart } from '@/lib/rtl';
import {
  useMyName,
  useMyClients,
  useMyInvitations,
  useCoachAdherence,
  useBodyMetricsBoard,
  useCoachLeaderboard,
  useAnalyticsInsight,
  useConversationPreviews,
  useRefreshOnFocus,
} from '@/lib/queries/home';
import { needsAttention, rosterAdherencePct, type AttentionRow } from '@/lib/analytics';
import { Icon, Screen, Text, Avatar, Card, GlassCard, KpiTile, EmptyState } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { theme } from '@/theme';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A small uppercase section label, matching the athlete-home rhythm. */
function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="label" muted style={textStart}>
      {children}
    </Text>
  );
}

/** Avatar + name + one-line meta + chevron — the shared coach roster row. */
function RosterRow({
  name,
  meta,
  metaColor,
  rank,
  glow,
  onPress,
}: {
  name: string;
  meta: string;
  metaColor?: string;
  rank?: number;
  glow?: boolean;
  onPress: () => void;
}) {
  return (
    <GlassCard onPress={onPress} glowColor={glow ? theme.colors.primary : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        {rank != null ? (
          <Text
            color={rank <= 3 ? theme.colors.primary : theme.colors.textMuted}
            style={{ width: 20, fontFamily: theme.fontFamily.monoBold, fontSize: 15 }}
          >
            {rank}
          </Text>
        ) : null}
        <Avatar name={name} size={40} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong" style={textStart}>
            {name}
          </Text>
          <Text variant="caption" color={metaColor ?? theme.colors.textMuted} style={textStart}>
            {meta}
          </Text>
        </View>
        <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
      </View>
    </GlassCard>
  );
}

export default function CoachHome() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  const nameQ = useMyName(userId);
  const clientsQ = useMyClients();
  const invitesQ = useMyInvitations();
  const adherenceQ = useCoachAdherence();
  const boardQ = useBodyMetricsBoard();
  const weekQ = useCoachLeaderboard();
  const insightQ = useAnalyticsInsight();
  const previewsQ = useConversationPreviews();

  useRefreshOnFocus(() => {
    nameQ.refetch();
    clientsQ.refetch();
    invitesQ.refetch();
    adherenceQ.refetch();
    boardQ.refetch();
    weekQ.refetch();
    insightQ.refetch();
    previewsQ.refetch();
  });

  const name = nameQ.data ?? null;
  const clients = clientsQ.data?.length ?? 0;
  const pending = invitesQ.data?.filter((i) => i.status === 'pending').length ?? 0;
  const roster = adherenceQ.data ?? [];
  const adherence = rosterAdherencePct(roster);
  const attention = needsAttention(roster).slice(0, 4);
  const board = boardQ.data ?? [];
  const performers = board.filter((r) => r.progress.hasTrend).slice(0, 3);
  const recentlyActive = (weekQ.data ?? []).filter((r) => r.sessions_done > 0).slice(0, 3);
  const insight = insightQ.data ?? null;
  const unread = (previewsQ.data ?? []).reduce((a, c) => a + c.unread_count, 0);

  const go = (href: Href) => () => router.push(href);
  const openClient = (id: string, n: string | null) => () =>
    router.push({ pathname: '/coach/client/[id]', params: { id, name: n ?? '' } });

  const adherenceColor =
    adherence == null
      ? theme.colors.textMuted
      : adherence >= 70
        ? theme.colors.success
        : adherence >= 40
          ? theme.colors.warning
          : theme.colors.danger;

  const attentionMeta = (a: AttentionRow): string => {
    if (a.reason === 'no_sessions') return t('home.reasonNoSessions');
    if (a.reason === 'inactive') return t('home.reasonInactive', { count: a.value });
    return t('home.reasonLowAdherence', { pct: a.value });
  };

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.md, gap: theme.spacing.xl }}>
      {/* Header — content-sized text column (flexShrink) so space-between pushes the
          cluster to the opposite end in LTR + RTL. The bell sits in a fixed box so its
          absolute unread badge doesn't skew the gap; avatar matches the athlete home (44). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.md }}>
        <View style={{ flexShrink: 1 }}>
          <Text variant="label" color="primary" style={textStart}>
            {t('home.performanceHub')}
          </Text>
          <Text variant="h1" style={textStart}>
            {name ? name.split(' ')[0] : t('home.coach')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          {/* Leaderboards moved to a dedicated bottom tab for coaches (no longer a header
              trophy). Account is reached by tapping the avatar. */}
          <View style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <NotificationBell />
          </View>
          <Pressable onPress={() => router.push('/(tabs)/account')}>
            <Avatar name={name ?? t('home.coach')} size={44} />
          </Pressable>
        </View>
      </View>

      {/* KPI grid (2×2) */}
      <View style={{ gap: theme.spacing.md }}>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <KpiTile value={pad2(clients)} label={t('home.activeClients')} tone="primary" icon="users" onPress={go('/(tabs)/clients')} />
          <KpiTile
            value={pad2(pending)}
            label={t('home.pendingInvites')}
            tone={pending > 0 ? 'warning' : 'neutral'}
            icon="user-plus"
            onPress={go('/coach/invite')}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
          <KpiTile
            value={adherence == null ? '—' : `${adherence}%`}
            label={t('home.rosterAdherence')}
            valueColor={adherenceColor}
            icon="activity"
            onPress={go('/(tabs)/performance')}
          />
          <KpiTile
            value={pad2(unread)}
            label={t('home.unreadMessages')}
            tone={unread > 0 ? 'warning' : 'neutral'}
            icon="message-square"
            onPress={go('/(tabs)/messages')}
          />
        </View>
      </View>

      {/* Needs attention — only when there are clients; degrades to a tiny "all on track"
          line rather than a big empty state that blanks the screen. */}
      {clients > 0 ? (
        <View style={{ gap: theme.spacing.md }}>
          <SectionLabel>{t('home.needsAttention')}</SectionLabel>
          {attention.length === 0 ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                <Icon name="check-circle" size={18} color={theme.colors.success} />
                <Text variant="body" muted style={[textStart, { flex: 1 }]}>
                  {t('home.allOnTrack')}
                </Text>
              </View>
            </Card>
          ) : (
            attention.map((a) => (
              <RosterRow
                key={a.client_id}
                name={a.full_name ?? t('home.client')}
                meta={attentionMeta(a)}
                metaColor={theme.colors.warning}
                onPress={openClient(a.client_id, a.full_name)}
              />
            ))
          )}
        </View>
      ) : null}

      {/* Top performers — graceful: real goal-relative ranking when there's InBody data,
          else "recently active" by sessions this week, else the invite empty state. */}
      <View style={{ gap: theme.spacing.md }}>
        <SectionLabel>{performers.length > 0 ? t('home.topPerformers') : t('home.recentlyActive')}</SectionLabel>
        {performers.length > 0 ? (
          performers.map((r, i) => (
            <RosterRow
              key={r.client_id}
              name={r.full_name ?? t('home.client')}
              meta={r.progress.headline}
              metaColor={theme.colors.primary}
              rank={i + 1}
              glow={i === 0}
              onPress={openClient(r.client_id, r.full_name)}
            />
          ))
        ) : recentlyActive.length > 0 ? (
          recentlyActive.map((r) => (
            <RosterRow
              key={r.client_id}
              name={r.full_name ?? t('home.client')}
              meta={t('ranks.setsLogged', { count: r.sets_done })}
              onPress={openClient(r.client_id, r.full_name)}
            />
          ))
        ) : clients === 0 ? (
          <EmptyState
            icon="people-outline"
            title={t('clients.emptyTitle')}
            subtitle={t('clients.emptySub')}
            actionLabel={t('clients.inviteAction')}
            onAction={() => router.push('/coach/invite')}
          />
        ) : (
          <Card>
            <Text variant="body" muted style={textStart}>
              {t('home.noActivityYet')}
            </Text>
          </Card>
        )}
        <Pressable onPress={go('/(tabs)/performance')} style={{ alignSelf: 'flex-start' }} hitSlop={8}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="caption" color={theme.colors.primary}>
              {t('home.viewPerformance')}
            </Text>
            <Icon name={forwardChevron()} size={14} color={theme.colors.primary} />
          </View>
        </Pressable>
      </View>

      {/* AI insight banner — shown only when a stored narration exists; never an empty state. */}
      {insight?.analysis ? (
        <Card onPress={go('/(tabs)/performance')}>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Icon name="sparkles-outline" size={20} color={theme.colors.primary} />
            <Text variant="body" style={[textStart, { flex: 1 }]} numberOfLines={3}>
              {insight.analysis}
            </Text>
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
