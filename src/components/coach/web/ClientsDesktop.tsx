// Desktop (coach web shell) variant of the Clients roster tab — Approach B. Mounted by
// app/(tabs)/clients.tsx via `if (active) return <ClientsDesktop/>`. It calls the SAME
// cached TanStack hooks + the SAME scoring helpers the mobile screen uses (no new query
// or RPC), and re-lays them out as a desktop dashboard: a KPI summary row + a fluid grid
// of client cards. The mobile tree in clients.tsx is left untouched for native / narrow web.
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMyClients, useCoachAdherence, useBodyMetricsBoard } from '@/lib/queries/home';
import { useIncomingCoachRequests } from '@/lib/queries/coach-requests';
import {
  adherenceScore,
  needsAttention,
  rosterAdherencePct,
  type AdherenceRow,
  type AttentionRow,
} from '@/lib/analytics';
import type { BoardRow, GoalProgress } from '@/lib/body-metrics';
import { forwardChevron, textStart } from '@/lib/rtl';
import {
  Avatar,
  Badge,
  Button,
  Chip,
  EmptyState,
  GlassCard,
  Icon,
  KpiTile,
  ResponsiveGrid,
  Screen,
  Text,
  type BadgeTone,
} from '@/components/ui';
import { theme } from '@/theme';

type Filter = 'all' | 'attention' | 'on_track';
// useBodyMetricsBoard runs `rankBoard` in its `select`, so each row carries `progress`.
type RankedBoardRow = BoardRow & { progress: GoalProgress; rank: number };

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

/** A `#RRGGBB` brand colour → an `rgba(...)` tint (theme colours are 6-digit hex). */
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ClientsDesktop() {
  const { t } = useTranslation();
  const router = useRouter();
  // Same shared cache as mobile + Home — warm on app open, cheap to re-read here.
  const clientsQ = useMyClients();
  const requestsQ = useIncomingCoachRequests();
  const adherenceQ = useCoachAdherence();
  const boardQ = useBodyMetricsBoard();
  const [filter, setFilter] = useState<Filter>('all');

  const clients = clientsQ.data ?? [];
  const roster = adherenceQ.data ?? [];
  const pendingRequests = requestsQ.data?.length ?? 0;

  // Index the prefetched coaching data by client for O(1) per-card lookup (mirrors mobile).
  const adherenceByClient = useMemo(
    () => new Map<string, AdherenceRow>(roster.map((r) => [r.client_id, r])),
    [roster],
  );
  const boardByClient = useMemo(
    () => new Map<string, RankedBoardRow>(((boardQ.data ?? []) as RankedBoardRow[]).map((r) => [r.client_id, r])),
    [boardQ.data],
  );
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

  // ── KPI summary (all honest, derived from the already-loaded data) ──
  const attnCount = attention.length;
  const onTrackCount = clients.filter((c) => !attentionByClient.has(c.id)).length;
  const avgAdherence = rosterAdherencePct(roster);

  const loading = clientsQ.isPending;
  const error = clientsQ.isError;

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
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.xl, gap: theme.spacing.xl }}>
      {/* Header: title + coach day-to-day actions (Invite is the primary CTA). */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing.lg }}>
        <View style={{ flexShrink: 1, gap: 4 }}>
          <Text variant="h1" style={textStart}>
            {t('clients.title')}
          </Text>
          <Text variant="caption" muted style={textStart}>
            {t('clients.activeCount', { count: clients.length })}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexShrink: 0 }}>
          <Button
            title={pendingRequests > 0 ? `${t('webportal.clients.requests')} · ${pendingRequests}` : t('webportal.clients.requests')}
            variant="secondary"
            fullWidth={false}
            left={<Icon name="user-plus" size={16} color={theme.colors.text} />}
            onPress={() => router.push('/coach/requests')}
          />
          <Button
            title={t('account.planTemplates')}
            variant="secondary"
            fullWidth={false}
            left={<Icon name="documents-outline" size={16} color={theme.colors.text} />}
            onPress={() => router.push('/coach/templates')}
          />
          <Button
            title={t('clients.invite')}
            variant="primary"
            fullWidth={false}
            left={<Icon name="person-add" size={16} color={theme.colors.onPrimary} />}
            onPress={() => router.push('/coach/invite')}
          />
        </View>
      </View>

      {/* KPI summary row (4-up). */}
      {clients.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.lg, flexWrap: 'wrap' }}>
          <KpiTile icon="users" label={t('webportal.clients.kpiTotal')} value={clients.length} style={{ minWidth: 180 }} />
          <KpiTile
            icon="flag"
            label={t('webportal.clients.kpiAttention')}
            value={attnCount}
            valueColor={attnCount > 0 ? theme.colors.warning : theme.colors.text}
            style={{ minWidth: 180 }}
          />
          <KpiTile
            icon="check-circle"
            label={t('webportal.clients.kpiOnTrack')}
            value={onTrackCount}
            valueColor={onTrackCount > 0 ? theme.colors.success : theme.colors.text}
            style={{ minWidth: 180 }}
          />
          <KpiTile
            icon="bar-chart"
            tone="primary"
            label={t('webportal.clients.kpiAvgAdherence')}
            value={avgAdherence != null ? `${avgAdherence}%` : '—'}
            style={{ minWidth: 180 }}
          />
        </View>
      ) : null}

      {/* Triage filter chips. */}
      {clients.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <Chip key={f.key} label={f.label} active={filter === f.key} onPress={() => setFilter(f.key)} />
          ))}
        </View>
      ) : null}

      {/* Roster grid, or empty / error state. */}
      {visible.length === 0 ? (
        loading ? null : (
          <EmptyState
            icon="people-outline"
            title={error ? t('clients.loadError') : t('clients.emptyTitle')}
            subtitle={error ? t('clients.pullRetry') : t('clients.emptySub')}
            actionLabel={error ? undefined : t('clients.inviteAction')}
            onAction={error ? undefined : () => router.push('/coach/invite')}
          />
        )
      ) : (
        <ResponsiveGrid minColWidth={320} gap={theme.spacing.lg}>
          {visible.map((item) => {
            const name = item.full_name ?? item.invited_email ?? t('home.client');
            const adh = adherenceByClient.get(item.id);
            const board = boardByClient.get(item.id);
            const attn = attentionByClient.get(item.id)?.row;
            const goal = board?.primary_goal ?? adh?.primary_goal ?? null;
            const pct = adh ? adherenceScore(adh).overallPct : null;
            const progress = board?.progress;
            const sessions = adh?.sessions_completed ?? null;

            // Progress tint: cyan when the client moved toward their goal, a soft warning
            // on a regression, muted when there isn't yet a rankable trend.
            const progressColor = progress?.hasTrend
              ? progress.score >= 0
                ? theme.colors.primary
                : theme.colors.warning
              : theme.colors.textMuted;

            const stats: { label: string; value: string; color: string }[] = [
              {
                label: t('webportal.clients.statAdherence'),
                value: pct != null ? `${pct}%` : '—',
                color: pct != null ? adherenceColor(pct) : theme.colors.textMuted,
              },
              {
                label: t('webportal.clients.statProgress'),
                value: progress?.hasTrend ? `${progress.score >= 0 ? '+' : '−'}${Math.abs(progress.score)}` : '—',
                color: progressColor,
              },
              {
                label: t('webportal.clients.statSessions'),
                value: sessions != null ? String(sessions) : '—',
                color: sessions != null ? theme.colors.text : theme.colors.textMuted,
              },
            ];

            const status: { label: string; tone: BadgeTone } = attn
              ? { label: t('webportal.clients.statusAttention'), tone: 'warning' }
              : adh
                ? { label: t('webportal.clients.statusOnTrack'), tone: 'success' }
                : { label: t('webportal.clients.statusNoData'), tone: 'neutral' };

            const footnote = progress?.hasTrend
              ? { text: progress.headline, color: progressColor }
              : attn
                ? { text: attentionMeta(attn), color: theme.colors.warning }
                : null;
            const lastActiveText = lastActive(adh);

            // Header badge = FFMI tier WHEN computable, else the training goal. The coach
            // board RPC (BoardRow) exposes latest weight + body-fat but NOT height_cm or
            // sex — both required by computeFfmi/ffmiTier — and no other loaded source has
            // them, so the tier is not computable here. Per the honesty rule we never show
            // a fabricated tier and fall back to the client's goal (the goal label is the
            // same dictionary lookup the mobile roster uses).
            const goalLabel = goal ? t(`goals.${goal}`, { defaultValue: goal }) : null;

            return (
              <GlassCard
                key={item.id}
                onPress={() => router.push({ pathname: '/coach/client/[id]', params: { id: item.id, name } })}
                style={{ gap: theme.spacing.md }}
              >
                {/* Identity row: avatar + name, badge (goal) on the trailing edge */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <Avatar name={name} size={48} />
                  <Text variant="title" numberOfLines={1} style={[textStart, { flex: 1 }]}>
                    {name}
                  </Text>
                  {goalLabel ? (
                    <View
                      style={{
                        alignSelf: 'flex-start',
                        backgroundColor: tint(theme.colors.secondary, 0.16),
                        borderRadius: theme.radii.full,
                        paddingHorizontal: theme.spacing.sm,
                        paddingVertical: 2,
                        flexShrink: 0,
                      }}
                    >
                      <Text variant="label" color="secondary" numberOfLines={1}>
                        {goalLabel}
                      </Text>
                    </View>
                  ) : null}
                  <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
                </View>

                {/* Boxed stats: each value in its own rounded inset, label beneath */}
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  {stats.map((s) => (
                    <View
                      key={s.label}
                      style={{
                        flex: 1,
                        backgroundColor: theme.colors.surfaceElevated,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        borderRadius: theme.radii.md,
                        paddingVertical: theme.spacing.sm,
                        paddingHorizontal: theme.spacing.sm,
                        gap: 2,
                      }}
                    >
                      <Text
                        color={s.color}
                        numberOfLines={1}
                        style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 18, lineHeight: 22 }}
                      >
                        {s.value}
                      </Text>
                      <Text variant="label" muted numberOfLines={1} style={[textStart, { fontSize: 9 }]}>
                        {s.label}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Divider */}
                <View style={{ height: 1, backgroundColor: theme.colors.border }} />

                {/* Status pill + last-active */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing.sm }}>
                  <Badge label={status.label} tone={status.tone} />
                  {lastActiveText ? (
                    <Text variant="caption" muted>
                      {lastActiveText}
                    </Text>
                  ) : null}
                </View>
                {footnote ? (
                  <Text variant="caption" color={footnote.color} style={textStart} numberOfLines={1}>
                    {footnote.text}
                  </Text>
                ) : null}
              </GlassCard>
            );
          })}
        </ResponsiveGrid>
      )}
    </Screen>
  );
}
