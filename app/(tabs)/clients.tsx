// Coach → clients roster. RLS (is_coach_of) returns only this coach's clients. This is
// the per-client KPI dashboard (U-2): each row shows the client's goal, goal-relative
// progress, adherence and last-active — the coaching answer "who is on/off track vs THEIR
// goal?", distinct from the Chat tab (which it used to resemble) and complementary to the
// Performance tab (whole-roster trends). Default order is needs-attention-first. All data
// is already prefetched (no new RPC): goal progress from the body-metrics board, adherence
// from the adherence overview — the same hooks + scoring CoachHome uses.
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMyClients, useCoachAdherence, useBodyMetricsBoard, useRefreshOnFocus } from '../../src/lib/queries/home';
import { useIncomingCoachRequests } from '../../src/lib/queries/coach-requests';
import { adherenceScore, needsAttention, type AdherenceRow, type AttentionRow } from '../../src/lib/analytics';
import type { BoardRow, GoalProgress } from '../../src/lib/body-metrics';
import { forwardChevron, textStart } from '../../src/lib/rtl';
import { Icon, Screen, Text, Card, Avatar, Badge, Chip, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';
import { useChrome } from '../../src/lib/chrome';
import { ClientsDesktop } from '../../src/components/coach/web/ClientsDesktop';

type Filter = 'all' | 'attention' | 'on_track';

/** Whole days since a YYYY-MM-DD date (device-local), or null. */
function daysSinceLocal(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(`${dateStr}T00:00:00`).getTime()) / 86_400_000);
}

/** Adherence-% tint, matching CoachHome's thresholds. */
function adherenceColor(pct: number | null): string {
  if (pct == null) return theme.colors.textMuted;
  if (pct >= 70) return theme.colors.success;
  if (pct >= 40) return theme.colors.warning;
  return theme.colors.danger;
}

export default function ClientsTab() {
  // Desktop coach web shell: the purpose-built dashboard variant is returned BELOW,
  // after every hook has run (rules-of-hooks), so resizing across the breakpoint is safe.
  const { active } = useChrome();

  const { t } = useTranslation();
  const router = useRouter();
  // Shared cache: warmed on app open + reused by Home, so this tab is populated on first visit.
  const clientsQ = useMyClients();
  const requestsQ = useIncomingCoachRequests();
  const adherenceQ = useCoachAdherence();
  const boardQ = useBodyMetricsBoard();
  const [filter, setFilter] = useState<Filter>('all');
  const pendingRequests = requestsQ.data?.length ?? 0;
  useRefreshOnFocus(() => {
    clientsQ.refetch();
    requestsQ.refetch();
    adherenceQ.refetch();
    boardQ.refetch();
  });

  const clients = clientsQ.data ?? [];
  const roster = adherenceQ.data ?? [];

  // Index the prefetched coaching data by client for O(1) per-row lookup.
  const adherenceByClient = useMemo(
    () => new Map<string, AdherenceRow>(roster.map((r) => [r.client_id, r])),
    [roster],
  );
  const boardByClient = useMemo(
    () => new Map<string, BoardRow & { progress: GoalProgress }>((boardQ.data ?? []).map((r) => [r.client_id, r])),
    [boardQ.data],
  );
  // needs-attention rows (worst-first); used for both the badge/meta and the default sort.
  const attention = useMemo(() => needsAttention(roster), [roster]);
  const attentionByClient = useMemo(
    () => new Map<string, { row: AttentionRow; order: number }>(attention.map((a, i) => [a.client_id, { row: a, order: i }])),
    [attention],
  );

  // Default order: attention clients first (worst-first), then the rest alphabetically.
  const ordered = useMemo(() => {
    const nameOf = (c: { full_name: string | null; invited_email?: string | null }) =>
      (c.full_name ?? c.invited_email ?? '').toLowerCase();
    return [...clients].sort((a, b) => {
      const ao = attentionByClient.get(a.id)?.order ?? Number.POSITIVE_INFINITY;
      const bo = attentionByClient.get(b.id)?.order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return nameOf(a).localeCompare(nameOf(b));
    });
  }, [clients, attentionByClient]);

  const visible = useMemo(
    () =>
      ordered.filter((c) => {
        if (filter === 'all') return true;
        const isAttn = attentionByClient.has(c.id);
        return filter === 'attention' ? isAttn : !isAttn;
      }),
    [ordered, filter, attentionByClient],
  );

  // Every hook above has run — now safe to branch to the desktop variant.
  if (active) return <ClientsDesktop />;

  const loading = clientsQ.isPending;
  const error = clientsQ.isError;
  const load = () => clientsQ.refetch();

  /** "{n}d ago" / "today" / "no sessions" from the adherence row. */
  const lastActive = (adh: AdherenceRow | undefined): string | null => {
    if (!adh) return null;
    if (adh.last_session_date == null) return t('clients.noSessions');
    const days = daysSinceLocal(adh.last_session_date);
    return days != null && days <= 0 ? t('clients.activeToday') : t('clients.activeDaysAgo', { count: days ?? 0 });
  };

  /** The warning meta for a needs-attention client (mirrors CoachHome's reasons). */
  const attentionMeta = (a: AttentionRow): string => {
    if (a.reason === 'no_sessions') return t('home.reasonNoSessions');
    if (a.reason === 'inactive') return t('home.reasonInactive', { count: a.value });
    return t('home.reasonLowAdherence', { pct: a.value });
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: t('clients.filterAll') },
    { key: 'attention', label: t('clients.filterAttention') },
    { key: 'on_track', label: t('clients.filterOnTrack') },
  ];

  return (
    <Screen padded={false} gradient>
      {/* Title sits on its own full-width row above the actions — three text-labelled
          action cards next to an h1 overflow a phone width and wrap the title mid-word. */}
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
          gap: theme.spacing.md,
        }}
      >
        <View>
          <Text variant="h1">{t('clients.title')}</Text>
          <Text variant="caption" muted>
            {t('clients.activeCount', { count: clients.length })}
          </Text>
        </View>
        {/* Coach day-to-day actions (moved out of the Account tab). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Card
            onPress={() => router.push('/coach/requests')}
            padded={false}
            style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="user-plus" size={16} color={theme.colors.primary} />
            {pendingRequests > 0 ? <Badge label={String(pendingRequests)} tone="primary" solid /> : null}
          </Card>
          <Card
            onPress={() => router.push('/coach/templates')}
            padded={false}
            style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="documents-outline" size={16} color={theme.colors.primary} />
            <Text variant="bodyStrong" color="primary">
              {t('account.planTemplates')}
            </Text>
          </Card>
          <Card
            onPress={() => router.push('/coach/invite')}
            padded={false}
            style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="person-add" size={16} color={theme.colors.primary} />
            <Text variant="bodyStrong" color="primary">
              {t('clients.invite')}
            </Text>
          </Card>
        </View>
      </View>

      {/* Triage filter chips — only when there's a roster to filter. */}
      {clients.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.md }}>
          {FILTERS.map((f) => (
            <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </View>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.colors.primary} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="people-outline"
              title={error ? t('clients.loadError') : t('clients.emptyTitle')}
              subtitle={error ? t('clients.pullRetry') : t('clients.emptySub')}
              actionLabel={error ? undefined : t('clients.inviteAction')}
              onAction={error ? undefined : () => router.push('/coach/invite')}
            />
          )
        }
        renderItem={({ item }) => {
          const name = item.full_name ?? item.invited_email ?? t('home.client');
          const adh = adherenceByClient.get(item.id);
          const board = boardByClient.get(item.id);
          const attn = attentionByClient.get(item.id)?.row;
          const goal = board?.primary_goal ?? adh?.primary_goal ?? null;
          const pct = adh ? adherenceScore(adh).overallPct : null;
          const progress = board?.progress;
          // The second stat line: goal progress when there's a verified trend, else the
          // attention reason (so it's useful even with no InBody data), else last-active.
          const trendLine = progress?.hasTrend ? progress.headline : null;
          return (
            <Card onPress={() => router.push({ pathname: '/coach/client/[id]', params: { id: item.id, name } })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={name} size={44} />
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Text variant="title" style={[textStart, { flexShrink: 1 }]} numberOfLines={1}>
                      {name}
                    </Text>
                    {goal ? <Badge label={t(`goals.${goal}`, { defaultValue: goal })} tone="secondary" solid /> : null}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, flexWrap: 'wrap' }}>
                    {pct != null ? (
                      <Text variant="caption" color={adherenceColor(pct)} style={textStart}>
                        {t('clients.metaAdherence', { pct })}
                      </Text>
                    ) : null}
                    {trendLine ? (
                      <Text variant="caption" color={theme.colors.primary} style={textStart}>
                        {trendLine}
                      </Text>
                    ) : attn ? (
                      <Text variant="caption" color={theme.colors.warning} style={textStart}>
                        {attentionMeta(attn)}
                      </Text>
                    ) : null}
                    {lastActive(adh) ? (
                      <Text variant="caption" muted style={textStart}>
                        {lastActive(adh)}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
