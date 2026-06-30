// ClientDetailDesktop (W-view, Approach B) — the desktop layout for one client's profile,
// rendered ONLY inside the coach web shell (CoachWebChrome → ChromeContext.active). The
// mobile screen (app/coach/client/[id].tsx) returns this after its role guard when `wide`.
// It re-reads the route params and calls the SAME data layer the mobile screen uses
// (listPlansForClient / getAthleteProfileFor / listBodyMetrics / getStreak / listSessions /
// getPlanInsight) — no new query, no fabricated stats. Layout: identity header + a 4-up KPI
// row + a two-pane body (left: bodyweight trend + latest metrics + pending InBody; right:
// assigned plans + AI insight + recent sessions). Module-scope helpers/cells get NO `t`.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { theme, type Tier } from '@/theme';
import {
  Avatar,
  Badge,
  Button,
  Card,
  DeltaChip,
  EmptyState,
  Icon,
  KpiTile,
  LineChart,
  ResponsiveGrid,
  Screen,
  Text,
  TierChip,
  useToast,
  type BadgeTone,
} from '@/components/ui';
import { forwardChevron, textStart } from '@/lib/rtl';
import { listPlansForClient, type Plan } from '@/lib/plans';
import { getAthleteProfileFor, type AthleteProfile } from '@/lib/athlete-profile';
import { listBodyMetrics, listUnverifiedOcrMetrics, type BodyMetric } from '@/lib/body-metrics';
import { getStreak, listSessions, type WorkoutSession } from '@/lib/sessions';
import { getPlanInsight } from '@/lib/coach-ai';
import { computeFfmi, ffmiTier } from '@/lib/leagues';
import { readCache } from '@/lib/screen-cache';
import { startAndJoinCall } from '@/lib/calls';

const STATUS_TONE: Record<Plan['status'], BadgeTone> = {
  draft: 'warning',
  published: 'success',
  archived: 'neutral',
};

type Good = 'low' | 'high' | 'neutral';
const round1 = (n: number) => Math.round(n * 10) / 10;

// Tint a since-baseline delta by whether the move is GOOD for the metric ('low' =
// lower-is-better like body fat, 'high' = higher-is-better like muscle, 'neutral' = uncolored).
function goodColor(delta: number | null | undefined, good: Good): string {
  if (delta == null || delta === 0 || good === 'neutral') return theme.colors.textMuted;
  const isGood = good === 'low' ? delta < 0 : delta > 0;
  return isGood ? theme.colors.success : theme.colors.danger;
}

function signed1(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
}

function daysAgo(date: string | null | undefined): number | null {
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000));
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// One stat in the "Latest metrics" grid: big mono value + uppercase unit label + optional
// signed delta. Module-scope, no copy of its own → no useTranslation needed (labels are props).
function StatCell({
  value,
  unit,
  delta,
  deltaColor,
}: {
  value: string;
  unit: string;
  delta?: number | null;
  deltaColor?: string;
}) {
  return (
    <View
      style={{
        backgroundColor: theme.colors.surfaceElevated,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: theme.radii.md,
        padding: theme.spacing.md,
        gap: 4,
      }}
    >
      <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 22, color: theme.colors.text }}>{value}</Text>
      <Text variant="label" muted style={{ fontSize: 9 }}>
        {unit}
      </Text>
      {delta != null && delta !== 0 ? (
        <Text variant="caption" color={deltaColor ?? theme.colors.textMuted}>
          {signed1(delta)}
        </Text>
      ) : null}
    </View>
  );
}

type Snapshot = {
  plans?: Plan[];
  goals?: AthleteProfile | null;
  metrics?: BodyMetric[];
  pendingOcr?: BodyMetric[];
  streak?: number;
  sessions?: WorkoutSession[];
  nudge?: string | null;
};

export function ClientDetailDesktop() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const cacheKey = id ? `coach-client:${id}` : null;
  const cached = readCache<Snapshot>(cacheKey);

  const [plans, setPlans] = useState<Plan[]>(cached?.plans ?? []);
  const [goals, setGoals] = useState<AthleteProfile | null>(cached?.goals ?? null);
  const [metrics, setMetrics] = useState<BodyMetric[]>(cached?.metrics ?? []);
  const [pendingOcr, setPendingOcr] = useState<BodyMetric[]>(cached?.pendingOcr ?? []);
  const [streak, setStreak] = useState(cached?.streak ?? 0);
  const [sessions, setSessions] = useState<WorkoutSession[]>(cached?.sessions ?? []);
  const [nudge, setNudge] = useState<string | null>(cached?.nudge ?? null);
  const [loading, setLoading] = useState(cached === undefined);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, g, m, o, wk, sess, ins] = await Promise.all([
        listPlansForClient(id),
        getAthleteProfileFor(id),
        listBodyMetrics(id),
        listUnverifiedOcrMetrics(id),
        getStreak(id).catch(() => 0),
        listSessions(id).catch(() => [] as WorkoutSession[]),
        getPlanInsight(id).catch(() => null),
      ]);
      setPlans(p);
      setGoals(g);
      setMetrics(m);
      setPendingOcr(o);
      setStreak(wk);
      setSessions(sess);
      setNudge(ins?.analysis ?? null);
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const displayName = name ?? t('clientDetail.client');

  // ── Derived (reuses the mobile screen's data-shaping) ──────────────────────
  const withWeight = metrics.filter((m) => m.weight_grams != null);
  const withFat = metrics.filter((m) => m.body_fat_bp != null);
  const withMuscle = metrics.filter((m) => m.skeletal_muscle_mass_grams != null);

  const wNow = withWeight.length ? round1(withWeight[withWeight.length - 1]!.weight_grams / 1000) : null;
  const wDelta =
    withWeight.length >= 2
      ? round1((withWeight[withWeight.length - 1]!.weight_grams - withWeight[0]!.weight_grams) / 1000)
      : null;
  const fNow = withFat.length ? round1(withFat[withFat.length - 1]!.body_fat_bp! / 100) : null;
  const fDelta =
    withFat.length >= 2 ? round1((withFat[withFat.length - 1]!.body_fat_bp! - withFat[0]!.body_fat_bp!) / 100) : null;
  const mNow = withMuscle.length ? round1(withMuscle[withMuscle.length - 1]!.skeletal_muscle_mass_grams! / 1000) : null;
  const leanDeltaKg =
    withMuscle.length >= 2
      ? round1(
          (withMuscle[withMuscle.length - 1]!.skeletal_muscle_mass_grams! -
            withMuscle[0]!.skeletal_muscle_mass_grams!) /
            1000,
        )
      : null;
  const visceralNow = [...metrics].reverse().find((m) => m.visceral_fat_level != null)?.visceral_fat_level ?? null;
  const bmrNow = [...metrics].reverse().find((m) => m.bmr_kcal != null)?.bmr_kcal ?? null;
  const latestAt = metrics.length ? metrics[metrics.length - 1]!.measured_at : null;

  const weightGood: Good =
    goals?.primary_goal === 'lose_fat'
      ? 'low'
      : goals?.primary_goal === 'build_muscle' || goals?.primary_goal === 'gain_strength'
        ? 'high'
        : 'neutral';

  // League tier from the latest verified InBody (same FFMI math as the public board) —
  // shown only when computable; never invented.
  const latestFat = [...metrics].reverse().find((m) => m.body_fat_bp != null) ?? null;
  const sex = goals?.sex ?? null;
  const ffmi = computeFfmi(latestFat?.weight_grams, latestFat?.body_fat_bp, goals?.height_cm);
  const tierId: Tier | null = ffmi != null && sex ? (ffmiTier(ffmi, sex) as Tier) : null;

  // Real "this week" adherence: completed sessions in the trailing 7 days vs the athlete's
  // own training-days target. Null target → not fairly scorable.
  const weekAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  })();
  const workoutsThisWeek = sessions.filter((s) => s.status === 'completed' && s.session_date >= weekAgo).length;
  const adherencePct =
    goals?.training_days && goals.training_days > 0
      ? Math.max(0, Math.min(100, Math.round((workoutsThisWeek / goals.training_days) * 100)))
      : null;

  // Active plan = the published training plan, else any published, else the newest.
  const activePlan =
    plans.find((p) => p.type === 'training' && p.status === 'published') ??
    plans.find((p) => p.status === 'published') ??
    plans[0] ??
    null;

  const lastSessionDate = sessions[0]?.session_date ?? null;
  const ago = daysAgo(lastSessionDate);
  const lastActiveStr = ago == null ? null : ago === 0 ? t('clients.activeToday') : t('clients.activeDaysAgo', { count: ago });

  const statusValue =
    ago == null ? '—' : ago <= 7 ? t('webportal.clientDetail.statusActive') : t('webportal.clientDetail.statusIdle');
  const statusColor = ago == null ? theme.colors.textMuted : ago <= 7 ? theme.colors.success : theme.colors.warning;
  const statusNote = lastActiveStr ?? t('webportal.clientDetail.statusNone');

  const totalChangeStr = wDelta == null ? '—' : `${signed1(wDelta)} ${t('clientDetail.kg')}`;
  const totalChangeColor = wDelta == null ? theme.colors.text : goodColor(wDelta, weightGood);

  const chart = withWeight.map((m) => ({ value: round1(m.weight_grams / 1000) }));

  const sessionStatusLabel = (st: WorkoutSession['status']) =>
    st === 'completed'
      ? t('progress.status.completed')
      : st === 'in_progress'
        ? t('progress.status.inProgress')
        : t('progress.status.skipped');
  const sessionStatusTone = (st: WorkoutSession['status']): BadgeTone =>
    st === 'completed' ? 'success' : st === 'in_progress' ? 'warning' : 'neutral';

  const shownSessions = expanded ? sessions : sessions.slice(0, 6);

  // Latest-metrics cells (only those with a real value).
  const cells: { value: string; unit: string; delta: number | null; color: string }[] = [];
  if (wNow != null) cells.push({ value: wNow.toFixed(1), unit: t('clientDetail.kg'), delta: wDelta, color: goodColor(wDelta, weightGood) });
  if (fNow != null) cells.push({ value: fNow.toFixed(1), unit: t('clientDetail.bodyFatPct'), delta: fDelta, color: goodColor(fDelta, 'low') });
  if (mNow != null) cells.push({ value: mNow.toFixed(1), unit: t('clientDetail.muscleKg'), delta: leanDeltaKg, color: goodColor(leanDeltaKg, 'high') });
  if (visceralNow != null) cells.push({ value: String(visceralNow), unit: t('webportal.clientDetail.visceralFat'), delta: null, color: theme.colors.textMuted });
  if (bmrNow != null) cells.push({ value: String(bmrNow), unit: t('webportal.clientDetail.bmr'), delta: null, color: theme.colors.textMuted });
  if (ffmi != null) cells.push({ value: ffmi.toFixed(1), unit: t('leaderboards.ffmi'), delta: null, color: theme.colors.textMuted });

  const cardLabel: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  };
  const drillRow: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.glassBorder,
  };

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.xl, gap: theme.spacing.lg }}>
      {/* ── Identity header ─────────────────────────────────────────────── */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
          <Avatar name={displayName} size={64} />
          <View style={{ flex: 1, gap: 6, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, flexWrap: 'wrap' }}>
              <Text variant="h1" style={textStart} numberOfLines={1}>
                {displayName}
              </Text>
              {tierId ? <TierChip tier={tierId} label={t(`leaderboards.tier.${tierId}`)} /> : null}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              <Text variant="caption" muted>
                {t('clientDetail.client')}
              </Text>
              <Text variant="caption" muted>
                ·
              </Text>
              <Text variant="caption" muted numberOfLines={1}>
                {activePlan?.title ?? t('webportal.clientDetail.noActivePlan')}
              </Text>
              {lastActiveStr ? (
                <>
                  <Text variant="caption" muted>
                    ·
                  </Text>
                  <Text variant="caption" muted>
                    {lastActiveStr}
                  </Text>
                </>
              ) : null}
              {leanDeltaKg != null ? <DeltaChip value={leanDeltaKg} suffix=" kg" /> : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <Button
              title={t('clientDetail.messageClient')}
              fullWidth={false}
              left={<Icon name="chatbubble-ellipses" size={16} color={theme.colors.onPrimary} />}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: id!, name: name ?? '' } })}
            />
            <Button
              title={t('calls.coach.callNow')}
              variant="secondary"
              fullWidth={false}
              left={<Icon name="video" size={16} color={theme.colors.text} />}
              onPress={() => { if (id) startAndJoinCall(id).catch(() => toast.show(t('calls.error.generic'), 'error')); }}
            />
          </View>
        </View>
      </Card>

      {/* ── 4-up KPI row ────────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        <KpiTile
          value={adherencePct == null ? '—' : `${adherencePct}%`}
          label={t('clientDetail.adherence')}
          tone="primary"
          icon="activity"
          note={t('performance.thisWeek')}
        />
        <KpiTile
          value={totalChangeStr}
          label={t('webportal.clientDetail.totalChange')}
          valueColor={totalChangeColor}
          icon="scale"
          note={t('webportal.clientDetail.sinceBaseline')}
        />
        <KpiTile
          value={String(streak)}
          label={t('clientDetail.dayStreak')}
          icon="flame"
          note={t('webportal.clientDetail.streakNote')}
        />
        <KpiTile
          value={statusValue}
          label={t('webportal.clientDetail.statusLabel')}
          valueColor={statusColor}
          icon="calendar"
          note={statusNote}
        />
      </View>

      {/* ── Two-pane body ───────────────────────────────────────────────── */}
      <View style={{ flexDirection: 'row', gap: theme.spacing.lg, alignItems: 'flex-start' }}>
        {/* LEFT: bodyweight trend + latest metrics + pending InBody */}
        <View style={{ flex: 1.25, gap: theme.spacing.lg, minWidth: 0 }}>
          <Card>
            <View style={cardLabel}>
              <Text variant="label" muted>
                {t('webportal.clientDetail.bodyweightTrend')}
              </Text>
              {wNow != null ? (
                <Text variant="caption" muted>{`${wNow.toFixed(1)} ${t('clientDetail.kg')}`}</Text>
              ) : null}
            </View>
            {loading && metrics.length === 0 ? (
              <View style={{ height: 220, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={theme.colors.primary} />
              </View>
            ) : chart.length >= 2 ? (
              <LineChart data={chart} height={220} unit={` ${t('clientDetail.kg')}`} />
            ) : (
              <EmptyState
                icon="trending-up"
                title={t('webportal.clientDetail.noReadingsTitle')}
                subtitle={t('webportal.clientDetail.noReadingsSub')}
              />
            )}
          </Card>

          <Card>
            <View style={cardLabel}>
              <Text variant="label" muted>
                {t('webportal.clientDetail.latestMetrics')}
              </Text>
              {latestAt ? (
                <Text variant="caption" muted>
                  {t('clientDetail.lastReading', { date: shortDate(latestAt) })}
                </Text>
              ) : null}
            </View>
            {cells.length > 0 ? (
              <ResponsiveGrid minColWidth={120} gap={12}>
                {cells.map((c, i) => (
                  <StatCell key={i} value={c.value} unit={c.unit} delta={c.delta} deltaColor={c.color} />
                ))}
              </ResponsiveGrid>
            ) : (
              <Text variant="caption" muted>
                {t('clientDetail.bodyCompHint')}
              </Text>
            )}
          </Card>

          {pendingOcr.length > 0 ? (
            <Card style={{ borderColor: theme.colors.warning }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                <Icon name="sparkles" size={16} color={theme.colors.warning} />
                <Text variant="label" muted style={{ flex: 1 }}>
                  {t('clientDetail.pendingInbody')}
                </Text>
                <Badge label={String(pendingOcr.length)} tone="warning" />
              </View>
              {pendingOcr.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() =>
                    router.push({ pathname: '/coach/body-metric', params: { metricId: m.id, clientName: name ?? '' } })
                  }
                  style={({ pressed }) => [drillRow, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Icon name="document-text" size={18} color={theme.colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text variant="body">
                      {m.body_fat_bp != null
                        ? t('clientDetail.scanFat', {
                            weight: Math.round(m.weight_grams / 100) / 10,
                            pct: Math.round(m.body_fat_bp / 10) / 10,
                          })
                        : t('clientDetail.scanWeight', { weight: Math.round(m.weight_grams / 100) / 10 })}
                    </Text>
                    <Text variant="caption" muted>
                      {new Date(m.measured_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </Text>
                  </View>
                  <Text variant="caption" color="warning">
                    {t('clientDetail.review')}
                  </Text>
                  <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
                </Pressable>
              ))}
            </Card>
          ) : null}
        </View>

        {/* RIGHT: assigned plans + AI insight + recent sessions */}
        <View style={{ flex: 1, gap: theme.spacing.lg, minWidth: 0 }}>
          <Card>
            <View style={cardLabel}>
              <Text variant="label" muted>
                {t('clientDetail.assignedPlans')}
              </Text>
              {plans.length > 0 ? (
                <Text variant="caption" muted>
                  {String(plans.length)}
                </Text>
              ) : null}
            </View>
            <Button
              title={t('clientDetail.assignFromTemplates')}
              left={<Icon name="add" size={18} color={theme.colors.onPrimary} />}
              onPress={() => router.push({ pathname: '/coach/templates', params: { clientId: id!, clientName: name ?? '' } })}
              style={{ marginBottom: theme.spacing.sm }}
            />
            {plans.length === 0 ? (
              <Text variant="body" muted style={{ marginTop: theme.spacing.sm }}>
                {t('clientDetail.noPlans')}
              </Text>
            ) : (
              plans.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => router.push({ pathname: '/coach/plan/[id]', params: { id: p.id } })}
                  style={({ pressed }) => [drillRow, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: theme.radii.md,
                      backgroundColor: theme.colors.glassStrong,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name={p.type === 'training' ? 'barbell' : 'restaurant'} size={20} color={theme.colors.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {p.title}
                    </Text>
                    <Badge label={t(`planStatus.${p.status}`)} tone={STATUS_TONE[p.status]} />
                  </View>
                  <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
                </Pressable>
              ))
            )}
          </Card>

          {nudge ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                <Icon name="sparkles" size={16} color={theme.colors.primary} />
                <Text variant="label" muted>
                  {t('webportal.clientDetail.aiInsight')}
                </Text>
              </View>
              <Text variant="body">{nudge}</Text>
            </Card>
          ) : null}

          <Card>
            <View style={cardLabel}>
              <Text variant="label" muted>
                {t('webportal.clientDetail.recentSessions')}
              </Text>
              {sessions.length > 6 ? (
                <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={8}>
                  <Text variant="caption" color="primary">
                    {expanded ? t('webportal.clientDetail.showLess') : t('webportal.clientDetail.viewAll', { n: sessions.length })}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {sessions.length === 0 ? (
              <Text variant="body" muted>
                {t('webportal.clientDetail.noSessions')}
              </Text>
            ) : (
              shownSessions.map((s) => (
                <View key={s.id} style={drillRow}>
                  <Icon name="calendar" size={16} color={theme.colors.textMuted} />
                  <Text variant="body" style={{ flex: 1 }}>
                    {shortDate(s.session_date)}
                  </Text>
                  <Badge label={sessionStatusLabel(s.status)} tone={sessionStatusTone(s.status)} />
                </View>
              ))
            )}
          </Card>
        </View>
      </View>
    </Screen>
  );
}
