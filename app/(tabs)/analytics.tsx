// Coach → Analytics tab (Phase 15, the anchor). A code-driven KPI dashboard: roster
// adherence, top athletes by goal-relative progress, plan effectiveness, and the goals
// the coach reliably delivers — all from DETERMINISTIC, coach-fenced RPCs (0031). AI is
// thin and last: a single card that NARRATES the computed numbers (coach-only storage).
// Built web/desktop-responsive — a centered max-width column that becomes a 2-column
// grid on wide screens (coaches will live in this on web). Coach-only; others redirect.
import { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import {
  useAnalyticsInsight,
  useBodyMetricsBoard,
  useCoachAdherence,
  useCoachPlanEffectiveness,
  useMyClients,
  useRefreshOnFocus,
} from '../../src/lib/queries/home';
import {
  ADHERENCE_WINDOW_DAYS,
  aiVsHuman,
  goalLabel,
  goalsDelivered,
  requestAnalyticsSummary,
  rosterAdherencePct,
  topPlans,
  type GoalDelivered,
} from '../../src/lib/analytics';
import type { AthleteGoal } from '../../src/schemas/athlete-profile';
import { Screen, Text, GlassCard, StatBlock, DeltaChip, Avatar, Badge, Button, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

const pad2 = (n: number) => String(n).padStart(2, '0');
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n)}`;

// Unit hint for an aggregated goal-relative score (matches goalProgress's per-goal metric).
function goalUnit(goal: AthleteGoal | null): string {
  if (goal === 'lose_fat') return '% body fat';
  if (goal === 'build_muscle' || goal === 'gain_strength') return 'kg muscle';
  return 'pts';
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="label" muted>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="caption" color={theme.colors.textMuted}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export default function AnalyticsTab() {
  const { t } = useTranslation();
  const { role, session } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  // The roster size + the "has clients" gate come from useMyClients — the SAME
  // deployed/cached source the Clients tab uses — so the page never wrongly shows
  // "no clients" (or flips) while the analytics RPCs load or if one is unavailable.
  const clientsQ = useMyClients();
  const adherenceQ = useCoachAdherence();
  const boardQ = useBodyMetricsBoard();
  const effQ = useCoachPlanEffectiveness();
  const insightQ = useAnalyticsInsight();

  const [busy, setBusy] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);

  useRefreshOnFocus(() => {
    clientsQ.refetch();
    adherenceQ.refetch();
    boardQ.refetch();
    effQ.refetch();
    insightQ.refetch();
  });

  // Coach-only surface — clients/admin never see this tab (hidden in the bar) but guard
  // the route too, so a deep link can't render it for the wrong role.
  if (role && role !== 'coach') return <Redirect href="/" />;
  if (!session?.user?.id) return null;

  const clients = clientsQ.data ?? [];
  const clientCount = clients.length;
  const roster = adherenceQ.data ?? [];
  const board = boardQ.data ?? [];
  const eff = effQ.data ?? [];
  const insight = insightQ.data ?? null;

  const avgAdherence = rosterAdherencePct(roster);
  // Only declare "no clients" once the (deployed, reliable) client list has loaded —
  // never off the analytics RPCs, which may still be loading or unavailable.
  const noClients = !clientsQ.isPending && clientCount === 0;
  const ranked = board.filter((r) => r.progress.hasTrend).slice(0, 5);
  const plans = topPlans(eff).slice(0, 5);
  const goals = goalsDelivered(board);
  const split = aiVsHuman(eff);

  const onGenerate = async () => {
    setBusy(true);
    setGenMsg(null);
    const res = await requestAnalyticsSummary();
    setBusy(false);
    if (res.status === 'analyzed') insightQ.refetch();
    else if (res.status === 'no_data') setGenMsg(t('analytics.noData'));
    else if (res.status === 'rate_limited') setGenMsg(t('analytics.rateLimited'));
    else setGenMsg(t('analytics.failed'));
  };

  const colStyle = { width: wide ? ('48%' as const) : ('100%' as const) };

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.md, gap: theme.spacing.xl }}>
      <View style={{ width: '100%', maxWidth: 1100, alignSelf: 'center', gap: theme.spacing.xl }}>
        {/* Header */}
        <View>
          <Text variant="label" color="primary">
            {t('analytics.label')}
          </Text>
          <Text variant="h1">{t('analytics.title')}</Text>
          <Text variant="caption" muted>
            {t('analytics.subtitle')}
          </Text>
        </View>

        {noClients ? (
          <EmptyState icon="people-outline" title={t('analytics.emptyTitle')} subtitle={t('analytics.emptySub')} />
        ) : (
          <>
            {/* Hero stats */}
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
                <StatBlock value={pad2(clientCount)} label={t('analytics.clients')} valueColor={theme.colors.primary} />
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
                  value={avgAdherence == null ? '—' : `${avgAdherence}%`}
                  label={t('analytics.avgAdherence')}
                  valueColor={
                    avgAdherence == null
                      ? theme.colors.textMuted
                      : avgAdherence >= 70
                        ? theme.colors.success
                        : avgAdherence >= 40
                          ? theme.colors.warning
                          : theme.colors.danger
                  }
                />
                <Text variant="caption" muted style={{ marginTop: 4 }}>
                  {t('analytics.windowNote', { days: ADHERENCE_WINDOW_DAYS })}
                </Text>
              </View>
            </View>

            {/* 2-up grid on wide screens, stacked on phone */}
            <View
              style={{
                flexDirection: wide ? 'row' : 'column',
                flexWrap: 'wrap',
                gap: theme.spacing.lg,
                justifyContent: 'space-between',
              }}
            >
              {/* Top athletes */}
              <View style={[colStyle, { gap: theme.spacing.md }]}>
                <SectionHeader title={t('analytics.topAthletes')} subtitle={t('analytics.topAthletesSub')} />
                {ranked.length === 0 ? (
                  <EmptyState icon="trophy-outline" title={t('analytics.noTrendTitle')} subtitle={t('analytics.noTrendSub')} />
                ) : (
                  ranked.map((r, i) => (
                    <GlassCard
                      key={r.client_id}
                      glowColor={i === 0 ? theme.colors.primary : undefined}
                      onPress={() =>
                        router.push({ pathname: '/coach/client/[id]', params: { id: r.client_id, name: r.full_name ?? '' } })
                      }
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                        <Text variant="title" color={i === 0 ? theme.colors.primary : theme.colors.textMuted} style={{ width: 18 }}>
                          {i + 1}
                        </Text>
                        <Avatar name={r.full_name ?? 'Client'} size={40} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="bodyStrong">{r.full_name ?? 'Client'}</Text>
                          <Text variant="caption" color="primary">
                            {r.progress.headline}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
                      </View>
                    </GlassCard>
                  ))
                )}
              </View>

              {/* Plan effectiveness */}
              <View style={[colStyle, { gap: theme.spacing.md }]}>
                <SectionHeader title={t('analytics.planEffectiveness')} subtitle={t('analytics.planEffectivenessSub')} />
                {plans.length === 0 ? (
                  <EmptyState icon="document-text-outline" title={t('analytics.noPlansTitle')} subtitle={t('analytics.noPlansSub')} />
                ) : (
                  plans.map((p) => (
                    <GlassCard key={p.key}>
                      <View style={{ gap: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                          <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                            {p.title}
                          </Text>
                          <Badge label={p.ai_generated ? t('analytics.ai') : t('analytics.handBuilt')} tone={p.ai_generated ? 'primary' : 'neutral'} />
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                          <DeltaChip value={p.avgScore} suffix="" />
                          <Text variant="caption" muted>
                            {p.headline} · {t('analytics.clientCount', { count: p.clients })}
                          </Text>
                        </View>
                      </View>
                    </GlassCard>
                  ))
                )}
                {/* AI vs hand-built quick read */}
                {split.ai.count + split.human.count > 0 ? (
                  <Text variant="caption" muted>
                    {t('analytics.ai')}: {split.ai.avgScore == null ? '—' : signed(split.ai.avgScore)} ({split.ai.count}) ·{' '}
                    {t('analytics.handBuilt')}: {split.human.avgScore == null ? '—' : signed(split.human.avgScore)} ({split.human.count})
                  </Text>
                ) : null}
              </View>

              {/* Goals delivered */}
              <View style={[colStyle, { gap: theme.spacing.md }]}>
                <SectionHeader title={t('analytics.goalsDelivered')} subtitle={t('analytics.goalsDeliveredSub')} />
                {goals.length === 0 ? (
                  <EmptyState icon="flag-outline" title={t('analytics.noTrendTitle')} subtitle={t('analytics.noTrendSub')} />
                ) : (
                  <GlassCard padded={false} style={{ overflow: 'hidden' }}>
                    {goals.map((g: GoalDelivered, i) => (
                      <View
                        key={(g.goal ?? 'none') + i}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: theme.spacing.md,
                          padding: theme.spacing.lg,
                          borderTopWidth: i === 0 ? 0 : 1,
                          borderTopColor: theme.colors.glassBorder,
                        }}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text variant="bodyStrong">{goalLabel(g.goal)}</Text>
                          <Text variant="caption" muted>
                            {t('analytics.clientCount', { count: g.clients })}
                          </Text>
                        </View>
                        <DeltaChip value={g.avgScore} suffix="" />
                        <Text variant="caption" muted style={{ width: 64 }}>
                          {goalUnit(g.goal)}
                        </Text>
                      </View>
                    ))}
                  </GlassCard>
                )}
              </View>

              {/* AI summary */}
              <View style={[colStyle, { gap: theme.spacing.md }]}>
                <SectionHeader title={t('analytics.aiSummary')} subtitle={t('analytics.aiSummarySub')} />
                <GlassCard>
                  <View style={{ gap: theme.spacing.md }}>
                    {insight ? (
                      <>
                        <Text variant="body">{insight.analysis}</Text>
                        <Text variant="caption" muted>
                          {t('analytics.updated', { when: new Date(insight.updated_at).toLocaleDateString() })}
                        </Text>
                      </>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                        <Ionicons name="sparkles-outline" size={18} color={theme.colors.primary} />
                        <Text variant="body" muted style={{ flex: 1 }}>
                          {t('analytics.aiSummarySub')}
                        </Text>
                      </View>
                    )}
                    {genMsg ? (
                      <Text variant="caption" color={theme.colors.warning}>
                        {genMsg}
                      </Text>
                    ) : null}
                    <Button
                      variant="secondary"
                      onPress={onGenerate}
                      loading={busy}
                      title={busy ? t('analytics.generating') : insight ? t('analytics.refresh') : t('analytics.generate')}
                    />
                  </View>
                </GlassCard>
              </View>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}
