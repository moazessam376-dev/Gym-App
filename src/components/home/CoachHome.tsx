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
import { useChrome } from '@/lib/chrome';
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
  useCoachPerformanceTrends,
  useCoachPlanEffectiveness,
  useRefreshOnFocus,
} from '@/lib/queries/home';
import { needsAttention, rosterAdherencePct, topPlans, type AttentionRow } from '@/lib/analytics';
import { Icon, Screen, Text, Avatar, Card, GlassCard, KpiTile, EmptyState, Chip } from '@/components/ui';
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
  const trendsQ = useCoachPerformanceTrends();
  const plansQ = useCoachPlanEffectiveness();
  const { active: wide } = useChrome();

  useRefreshOnFocus(() => {
    nameQ.refetch();
    clientsQ.refetch();
    invitesQ.refetch();
    adherenceQ.refetch();
    boardQ.refetch();
    weekQ.refetch();
    insightQ.refetch();
    previewsQ.refetch();
    trendsQ.refetch();
    plansQ.refetch();
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
  // Desktop-only extras (cheap cached reads): weekly roster-activity trend + "plans that work".
  const trends = trendsQ.data ?? [];
  const plans = topPlans(plansQ.data ?? []).slice(0, 5);

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

  // ── Desktop coach portal (wide web + coach role) ─────────────────────────────
  // A purpose-built multi-column dashboard: a 4-up KPI row, then a two-column region
  // (weekly sessions + needs-attention | top clients + top plans + AI insight). Same
  // cached hooks — no new data. The phone layout below is left byte-for-byte untouched.
  if (wide) {
    const maxSessions = Math.max(1, ...trends.map((p) => p.sessions_logged));
    const wkLabel = (d: string) => {
      const [, m, day] = d.split('-');
      return `${Number(m)}/${Number(day)}`;
    };
    const topClients = board.filter((r) => r.progress.hasTrend).slice(0, 6);
    const activeRows = (weekQ.data ?? []).filter((r) => r.sessions_done > 0).slice(0, 6);
    const divider = { borderTopWidth: 1, borderTopColor: theme.colors.border } as const;
    const rankNum = (rank: number, top: boolean) => (
      <Text
        color={top ? theme.colors.primary : theme.colors.textMuted}
        style={{ width: 24, fontFamily: theme.fontFamily.monoBold, fontSize: 14 }}
      >
        {rank}
      </Text>
    );
    const cardTitle = (title: string, link?: { label: string; onPress: () => void }) => (
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: theme.spacing.lg,
        }}
      >
        <Text variant="bodyStrong" style={textStart}>
          {title}
        </Text>
        {link ? (
          <Pressable onPress={link.onPress} hitSlop={8}>
            <Text variant="caption" color={theme.colors.primary}>
              {link.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    );

    return (
      <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.md, gap: theme.spacing.xl }}>
        {/* Page heading (the shell top bar holds the bell/avatar — not duplicated here). */}
        <View>
          <Text variant="label" color="primary" style={textStart}>
            {t('home.performanceHub')}
          </Text>
          <Text variant="h1" style={textStart}>
            {name ? name.split(' ')[0] : t('home.coach')}
          </Text>
        </View>

        {/* 4-up KPI row */}
        <View style={{ flexDirection: 'row', gap: theme.spacing.lg }}>
          <KpiTile value={pad2(clients)} label={t('home.activeClients')} tone="primary" icon="users" onPress={go('/(tabs)/clients')} />
          <KpiTile
            value={pad2(pending)}
            label={t('home.pendingInvites')}
            tone={pending > 0 ? 'warning' : 'neutral'}
            icon="user-plus"
            onPress={go('/coach/invite')}
          />
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

        {/* Two-column region */}
        <View style={{ flexDirection: 'row', gap: theme.spacing.lg, alignItems: 'flex-start' }}>
          {/* LEFT — weekly sessions + needs attention */}
          <View style={{ flex: 1.4, gap: theme.spacing.lg }}>
            <Card>
              {cardTitle(t('webportal.dashboard.weeklySessions'), {
                label: t('home.viewPerformance'),
                onPress: () => router.push('/(tabs)/performance'),
              })}
              {trends.length > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm, height: 184, paddingTop: theme.spacing.md }}>
                  {trends.map((pt) => {
                    const h = Math.max(4, Math.round((pt.sessions_logged / maxSessions) * 120));
                    return (
                      <View key={pt.week_start} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                        <Text variant="mono" style={{ fontSize: 11 }}>
                          {pt.sessions_logged}
                        </Text>
                        <View
                          style={{
                            width: '100%',
                            height: h,
                            backgroundColor: theme.colors.primary,
                            borderTopLeftRadius: 6,
                            borderTopRightRadius: 6,
                          }}
                        />
                        <Text variant="caption" muted style={{ fontSize: 10 }}>
                          {wkLabel(pt.week_start)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text variant="body" muted style={textStart}>
                  {t('home.noActivityYet')}
                </Text>
              )}
            </Card>

            {clients > 0 ? (
              <Card>
                {cardTitle(t('home.needsAttention'))}
                {attention.length === 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Icon name="check-circle" size={18} color={theme.colors.success} />
                    <Text variant="body" muted style={[textStart, { flex: 1 }]}>
                      {t('home.allOnTrack')}
                    </Text>
                  </View>
                ) : (
                  attention.map((a, i) => (
                    <Pressable
                      key={a.client_id}
                      onPress={openClient(a.client_id, a.full_name)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm, ...(i > 0 ? divider : null) }}
                    >
                      <Avatar name={a.full_name ?? t('home.client')} size={36} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="bodyStrong" numberOfLines={1} style={textStart}>
                          {a.full_name ?? t('home.client')}
                        </Text>
                        <Text variant="caption" color={theme.colors.warning} style={textStart}>
                          {attentionMeta(a)}
                        </Text>
                      </View>
                      <Icon name={forwardChevron()} size={16} color={theme.colors.textMuted} />
                    </Pressable>
                  ))
                )}
              </Card>
            ) : null}
          </View>

          {/* RIGHT — top clients + top plans + AI insight */}
          <View style={{ flex: 1, gap: theme.spacing.lg }}>
            <Card>
              {cardTitle(t('webportal.dashboard.topClients'), {
                label: t('webportal.dashboard.viewAll'),
                onPress: () => router.push('/(tabs)/clients'),
              })}
              {topClients.length > 0 ? (
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingBottom: theme.spacing.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
                    <Text variant="label" muted style={{ width: 24 }}>#</Text>
                    <Text variant="label" muted style={[textStart, { flex: 2 }]}>{t('performance.matrixClient')}</Text>
                    <Text variant="label" muted style={[textStart, { flex: 1.6 }]}>{t('webportal.dashboard.progress')}</Text>
                    <Text variant="label" muted style={[textStart, { flex: 1.2 }]}>{t('performance.matrixGoal')}</Text>
                  </View>
                  {topClients.map((r) => (
                    <Pressable
                      key={r.client_id}
                      onPress={openClient(r.client_id, r.full_name)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.sm, ...divider }}
                    >
                      {rankNum(r.rank, r.rank <= 3)}
                      <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                        <Avatar name={r.full_name ?? t('home.client')} size={32} />
                        <Text variant="bodyStrong" numberOfLines={1} style={[textStart, { flex: 1 }]}>
                          {r.full_name ?? t('home.client')}
                        </Text>
                      </View>
                      <Text variant="caption" color={theme.colors.primary} numberOfLines={1} style={[textStart, { flex: 1.6 }]}>
                        {r.progress.headline}
                      </Text>
                      <View style={{ flex: 1.2, alignItems: 'flex-start' }}>
                        {r.primary_goal ? (
                          <Chip label={t(`goals.${r.primary_goal}`)} />
                        ) : (
                          <Text variant="caption" muted>—</Text>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : activeRows.length > 0 ? (
                activeRows.map((r, i) => (
                  <Pressable
                    key={r.client_id}
                    onPress={openClient(r.client_id, r.full_name)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm, ...(i > 0 ? divider : null) }}
                  >
                    <Avatar name={r.full_name ?? t('home.client')} size={32} />
                    <Text variant="bodyStrong" numberOfLines={1} style={[textStart, { flex: 1 }]}>
                      {r.full_name ?? t('home.client')}
                    </Text>
                    <Text variant="caption" muted>
                      {t('ranks.setsLogged', { count: r.sets_done })}
                    </Text>
                  </Pressable>
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
                <Text variant="body" muted style={textStart}>
                  {t('home.noActivityYet')}
                </Text>
              )}
            </Card>

            {plans.length > 0 ? (
              <Card>
                {cardTitle(t('webportal.dashboard.topPlans'))}
                {plans.map((p, i) => (
                  <View
                    key={p.key}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, paddingVertical: theme.spacing.sm, ...(i > 0 ? divider : null) }}
                  >
                    {rankNum(i + 1, i < 3)}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong" numberOfLines={1} style={textStart}>
                        {p.title}
                      </Text>
                      <Text variant="caption" muted numberOfLines={1} style={textStart}>
                        {t('webportal.dashboard.clientsAssigned', { count: p.clients })} · {p.headline}
                      </Text>
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}

            {insight?.analysis ? (
              <Card onPress={go('/(tabs)/performance')}>
                <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                  <Icon name="sparkles-outline" size={20} color={theme.colors.primary} />
                  <Text variant="body" style={[textStart, { flex: 1 }]} numberOfLines={4}>
                    {insight.analysis}
                  </Text>
                </View>
              </Card>
            ) : null}
          </View>
        </View>
      </Screen>
    );
  }

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
