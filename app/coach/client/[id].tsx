// Coach → one client's profile: progress snapshot + their assigned plans.
// Plans are assigned from templates (not created here); tapping one opens the editor.
// Progress stats are REAL (Phase 15): streak + this-week workouts come from completion
// logging (0016), adherence is workouts vs the athlete's training-days target (0017),
// and the lean-mass delta from verified InBody readings (0026).
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/lib/auth-context';
import { deletePlan, listPlansForClient, type Plan } from '../../../src/lib/plans';
import { confirmDestructive } from '../../../src/lib/confirm';
import { generatePlan, getPlanInsight, requestPlanNudge } from '../../../src/lib/coach-ai';
import type { PlanType } from '../../../src/schemas/plan';
import { getAthleteProfileFor, type AthleteProfile } from '../../../src/lib/athlete-profile';
import { listClientNotes, type WorkoutNote } from '../../../src/lib/workout-notes';
import { listBodyMetrics, listUnverifiedOcrMetrics, type BodyMetric } from '../../../src/lib/body-metrics';
import {
  getDailyNutrition,
  getNutritionStreak,
  getTargets,
  getWeekNutrition,
  todayLocalDate,
  type DailyNutrition,
  type NutritionTargets,
  type WeekNutrition,
} from '../../../src/lib/nutrition';
import { getStreak, listSessions, type WorkoutSession } from '../../../src/lib/sessions';
import { readCache, writeCache } from '../../../src/lib/screen-cache';
import { Icon, IconButton, Screen, Text, Avatar, GlassCard, Badge, Button, Chip, DeltaChip, Input, Segmented } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

// Warm-cache snapshot so re-opening a client renders instantly (then refetches).
type ClientSnapshot = {
  plans: Plan[];
  goals: AthleteProfile | null;
  nutTargets: NutritionTargets | null;
  nutDaily: DailyNutrition | null;
  nutWeek: WeekNutrition | null;
  nutStreak: number;
  notes: WorkoutNote[];
  metrics: BodyMetric[];
  pendingOcr: BodyMetric[];
  nudge: string | null;
  streak: number;
  sessions: WorkoutSession[];
};

const STATUS_TONE = { draft: 'warning', published: 'success', archived: 'neutral' } as const;

// Quick-add prompt chips so coaches get high-quality AI output without typing much.
// i18n keys under clientDetail.chips.* — labels resolve via t() at render.
const PROMPT_CHIP_KEYS: Record<PlanType, string[]> = {
  training: ['ppl', 'ul', 'fullBody', 'kneeFriendly', 'minimalEquipment', 'progressiveOverload', 'includeCore'],
  nutrition: ['highProtein', 'budget', 'quick', 'moreVeg', 'lowCarb', 'vegetarian'],
};

/** Append a chip phrase to the prompt (comma-separated), avoiding duplicates. */
function appendChip(prev: string, phrase: string): string {
  const parts = prev.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === phrase.toLowerCase())) return prev;
  return [...parts, phrase].join(', ');
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 22, color: theme.colors.text }}>{value}</Text>
      <Text variant="label" muted style={{ fontSize: 9 }}>
        {label}
      </Text>
    </View>
  );
}

export default function ClientDetail() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const cacheKey = id ? `coach-client:${id}` : null;
  const cached = readCache<ClientSnapshot>(cacheKey);

  const [plans, setPlans] = useState<Plan[]>(cached?.plans ?? []);
  const [goals, setGoals] = useState<AthleteProfile | null>(cached?.goals ?? null);
  const [nutTargets, setNutTargets] = useState<NutritionTargets | null>(cached?.nutTargets ?? null);
  const [nutDaily, setNutDaily] = useState<DailyNutrition | null>(cached?.nutDaily ?? null);
  const [nutWeek, setNutWeek] = useState<WeekNutrition | null>(cached?.nutWeek ?? null);
  const [nutStreak, setNutStreak] = useState(cached?.nutStreak ?? 0);
  const [notes, setNotes] = useState<WorkoutNote[]>(cached?.notes ?? []);
  const [metrics, setMetrics] = useState<BodyMetric[]>(cached?.metrics ?? []);
  const [pendingOcr, setPendingOcr] = useState<BodyMetric[]>(cached?.pendingOcr ?? []);
  const [streak, setStreak] = useState(cached?.streak ?? 0);
  const [sessions, setSessions] = useState<WorkoutSession[]>(cached?.sessions ?? []);
  const [loading, setLoading] = useState(cached === undefined);

  // Coach AI (Phase 13): plan-gen modal + plan-adjustment nudges. Coach-only.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiType, setAiType] = useState<PlanType>('training');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [nudge, setNudge] = useState<string | null>(cached?.nudge ?? null);
  const [nudgePrompt, setNudgePrompt] = useState('');
  const [nudgeBusy, setNudgeBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const today = todayLocalDate();
      const [p, g, tg, d, w, s, n, m, o, ins, wk, sess] = await Promise.all([
        listPlansForClient(id),
        getAthleteProfileFor(id),
        getTargets(id),
        getDailyNutrition(id, today),
        getWeekNutrition(id, today),
        getNutritionStreak(id),
        listClientNotes(id, 8),
        listBodyMetrics(id),
        listUnverifiedOcrMetrics(id),
        getPlanInsight(id).catch(() => null),
        getStreak(id).catch(() => 0),
        listSessions(id).catch(() => [] as WorkoutSession[]),
      ]);
      setPlans(p);
      setGoals(g);
      setNutTargets(tg);
      setNutDaily(d);
      setNutWeek(w);
      setNutStreak(s);
      setNotes(n);
      setMetrics(m);
      setPendingOcr(o);
      setNudge(ins?.analysis ?? null);
      setStreak(wk);
      setSessions(sess);
      writeCache<ClientSnapshot>(cacheKey, {
        plans: p, goals: g, nutTargets: tg, nutDaily: d, nutWeek: w, nutStreak: s, notes: n, metrics: m, pendingOcr: o, nudge: ins?.analysis ?? null, streak: wk, sessions: sess,
      });
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Real lean-mass delta from verified InBody readings (0026): latest − baseline
  // skeletal muscle mass, in kg. Replaces the SAMPLE delta once real data exists.
  const muscleReadings = metrics.filter((m) => m.skeletal_muscle_mass_grams != null);
  const realLeanDeltaKg =
    muscleReadings.length >= 2
      ? Math.round(
          ((muscleReadings[muscleReadings.length - 1]!.skeletal_muscle_mass_grams! -
            muscleReadings[0]!.skeletal_muscle_mass_grams!) /
            1000) *
            10,
        ) / 10
      : null;

  // Real "this week" adherence (0016/0017): completed sessions in the trailing 7 days vs
  // the athlete's own training-days target. Null target → adherence can't be fairly scored.
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

  // Remove an assigned plan (RLS plans_delete allows the authoring coach). Confirm,
  // drop it locally on success, and re-sync from the server on any failure.
  async function onDeletePlan(plan: Plan) {
    const ok = await confirmDestructive(
      t('clientDetail.deletePlanTitle'),
      t('clientDetail.deletePlanBody', { title: plan.title }),
      t('common.delete'),
    );
    if (!ok) return;
    try {
      await deletePlan(plan.id);
      setPlans((prev) => prev.filter((p) => p.id !== plan.id));
    } catch {
      load();
    }
  }

  async function onGenerate() {
    if (!id || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await generatePlan({ clientId: id, type: aiType, coachPrompt: aiPrompt.trim() || undefined });
      if (res.status === 'generated' && res.plan_id) {
        setAiOpen(false);
        setAiPrompt('');
        router.push({ pathname: '/coach/plan/[id]', params: { id: res.plan_id } });
      } else if (res.status === 'no_profile') {
        Alert.alert(t('clientDetail.profileNeededTitle'), t('clientDetail.profileNeededBody'));
      } else if (res.status === 'rate_limited') {
        Alert.alert(t('clientDetail.dailyLimitTitle'), t('clientDetail.planLimitBody'));
      } else {
        Alert.alert(t('clientDetail.genFailTitle'), t('clientDetail.genFailBody'));
      }
    } finally {
      setAiBusy(false);
    }
  }

  async function onNudge() {
    if (!id || nudgeBusy) return;
    setNudgeBusy(true);
    try {
      const res = await requestPlanNudge(id, nudgePrompt.trim() || undefined);
      if (res.status === 'analyzed' && res.analysis) {
        setNudge(res.analysis);
        setNudgePrompt('');
      } else if (res.status === 'no_data') {
        Alert.alert(t('clientDetail.notEnoughTitle'), t('clientDetail.notEnoughBody'));
      } else if (res.status === 'rate_limited') {
        Alert.alert(t('clientDetail.dailyLimitTitle'), t('clientDetail.nudgeLimitBody'));
      } else {
        Alert.alert(t('clientDetail.analyzeFailTitle'), t('clientDetail.analyzeFailBody'));
      }
    } finally {
      setNudgeBusy(false);
    }
  }

  if (role && role !== 'coach') return <Redirect href="/" />;
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <>
    <Screen gradient padded={false} edges={['bottom']}>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.lg, marginBottom: theme.spacing.sm }}>
            {/* Identity */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Avatar name={name ?? t('clientDetail.client')} size={56} />
              <View style={{ flex: 1 }}>
                <Text variant="h2">{name ?? t('clientDetail.client')}</Text>
                <Text variant="caption" muted>
                  {t('clientDetail.client')}
                </Text>
              </View>
            </View>

            {/* Progress snapshot (REAL — completion logging 0016 + verified InBody 0026) */}
            <GlassCard glowColor={theme.colors.primary}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.md }}>
                <Text variant="label" muted>
                  {t('clientDetail.thisWeek')}
                </Text>
                {realLeanDeltaKg != null ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Text variant="caption" muted>
                      {t('clientDetail.leanMass')}
                    </Text>
                    <DeltaChip value={realLeanDeltaKg} suffix=" kg" />
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row' }}>
                <MiniStat value={String(streak)} label={t('clientDetail.dayStreak')} />
                <MiniStat value={String(workoutsThisWeek)} label={t('clientDetail.workouts')} />
                <MiniStat value={adherencePct == null ? '—' : `${adherencePct}%`} label={t('clientDetail.adherence')} />
              </View>
            </GlassCard>

            {/* Client goals (real data from athlete_profile, 0017) */}
            {goals?.onboarded_at ? (
              <GlassCard>
                <Text variant="label" muted style={{ marginBottom: theme.spacing.sm }}>
                  {t('clientDetail.goalsTitle')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  {goals.primary_goal ? <Chip label={t(`goals.${goals.primary_goal}`)} active /> : null}
                  {goals.experience_level ? <Chip label={t(`profileSetup.exp.${goals.experience_level}`)} /> : null}
                  {goals.training_days != null ? <Chip label={t('clientDetail.daysPerWeek', { days: goals.training_days })} /> : null}
                  {goals.target_weight_grams ? <Chip label={t('clientDetail.targetKg', { kg: Math.round(goals.target_weight_grams / 1000) })} /> : null}
                  {goals.dietary_tags.map((tag) => (
                    <Chip key={tag} label={t(`profileSetup.diet.${tag}`)} />
                  ))}
                </View>
                {goals.injuries_notes ? (
                  <Text variant="caption" muted style={{ marginTop: theme.spacing.sm, fontStyle: 'italic' }}>
                    {goals.injuries_notes}
                  </Text>
                ) : null}
              </GlassCard>
            ) : null}

            {/* Coach AI assistant (Phase 13) — coach-only tools. Plan-gen drafts a
                plan the coach edits + publishes; nudges are private decision-support. */}
            <GlassCard glowColor={theme.colors.primary}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                <Icon name="sparkles" size={16} color={theme.colors.primary} />
                <Text variant="label" muted style={{ flex: 1 }}>
                  {t('clientDetail.aiAssistant')}
                </Text>
              </View>
              <Button
                title={t('clientDetail.generateWithAi')}
                variant="secondary"
                left={<Icon name="sparkles" size={16} color={theme.colors.text} />}
                onPress={() => setAiOpen(true)}
              />
              <View style={{ height: 1, backgroundColor: theme.colors.glassBorder, marginVertical: theme.spacing.md }} />
              <Text variant="caption" muted style={{ marginBottom: theme.spacing.sm }}>
                {t('clientDetail.planAdjustIntro')}
              </Text>
              {nudge ? (
                <Text variant="body" style={{ marginBottom: theme.spacing.sm }}>
                  {nudge}
                </Text>
              ) : null}
              <Input
                value={nudgePrompt}
                onChangeText={setNudgePrompt}
                placeholder={t('clientDetail.nudgePlaceholder')}
                editable={!nudgeBusy}
              />
              <Button
                title={nudge ? t('clientDetail.refreshSuggestions') : t('clientDetail.suggestAdjustments')}
                variant="ghost"
                onPress={onNudge}
                loading={nudgeBusy}
                style={{ marginTop: theme.spacing.sm }}
              />
            </GlassCard>

            {/* Nutrition adherence (real data, migration 0019) */}
            <GlassCard>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.md }}>
                <Text variant="label" muted>
                  {t('clientDetail.nutrition')}
                </Text>
                {nutTargets ? (
                  <Text variant="caption" muted>
                    {t('clientDetail.todayKcal', { consumed: nutDaily?.kcal_total ?? 0, target: nutTargets.kcal_target })}
                  </Text>
                ) : null}
              </View>
              {nutWeek && (nutWeek.daysLogged > 0 || nutTargets) ? (
                <View style={{ flexDirection: 'row' }}>
                  <MiniStat value={String(nutStreak)} label={t('clientDetail.logStreak')} />
                  <MiniStat value={`${nutWeek.daysLogged}/7`} label={t('clientDetail.daysLogged')} />
                  <MiniStat value={String(nutWeek.average.kcal)} label={t('clientDetail.avgKcal')} />
                </View>
              ) : (
                <Text variant="caption" muted>
                  {t('clientDetail.noNutrition')}
                </Text>
              )}
            </GlassCard>

            {/* Pending OCR readings to confirm (Phase 12b). Auto-read from the client's
                scans; unverified until the coach confirms — tap to review against the scan. */}
            {pendingOcr.length > 0 ? (
              <GlassCard glowColor={theme.colors.warning}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, marginBottom: theme.spacing.sm }}>
                  <Icon name="sparkles" size={16} color={theme.colors.warning} />
                  <Text variant="label" muted style={{ flex: 1 }}>
                    {t('clientDetail.pendingInbody')}
                  </Text>
                  <Badge label={String(pendingOcr.length)} tone="warning" />
                </View>
                <Text variant="caption" muted style={{ marginBottom: theme.spacing.sm }}>
                  {t('clientDetail.pendingIntro')}
                </Text>
                <View style={{ gap: theme.spacing.sm }}>
                  {pendingOcr.map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() =>
                        router.push({ pathname: '/coach/body-metric', params: { metricId: m.id, clientName: name ?? '' } })
                      }
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: theme.spacing.md,
                        paddingVertical: theme.spacing.xs,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Icon name="document-text" size={18} color={theme.colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text variant="body">
                          {m.body_fat_bp != null
                            ? t('clientDetail.scanFat', { weight: Math.round(m.weight_grams / 100) / 10, pct: Math.round(m.body_fat_bp / 10) / 10 })
                            : t('clientDetail.scanWeight', { weight: Math.round(m.weight_grams / 100) / 10 })}
                        </Text>
                        <Text variant="caption" muted>
                          {new Date(m.measured_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                      </View>
                      <Text variant="caption" color="warning">
                        {t('clientDetail.review')}
                      </Text>
                      <Icon name="chevron-forward" size={18} color={theme.colors.textMuted} />
                    </Pressable>
                  ))}
                </View>
              </GlassCard>
            ) : null}

            {/* Progress: weight trend + photos + InBody (read-only; ?clientId=) */}
            <GlassCard>
              <Text variant="label" muted style={{ marginBottom: theme.spacing.sm }}>
                {t('clientDetail.progressTitle')}
              </Text>
              <View style={{ gap: theme.spacing.sm }}>
                {[
                  { icon: 'body' as const, label: t('progress.bodyComposition'), route: '/client/progress/body-comp' as const },
                  { icon: 'trending-up' as const, label: t('clientDetail.weightHistory'), route: '/client/progress/weight' as const },
                  { icon: 'camera' as const, label: t('progress.progressPhotos'), route: '/client/progress/photos' as const },
                  { icon: 'document-text' as const, label: t('progress.inbodyScans'), route: '/client/progress/inbody' as const },
                ].map((row) => (
                  <Pressable
                    key={row.route}
                    onPress={() => router.push({ pathname: row.route, params: { clientId: id, clientName: name ?? '' } })}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: theme.spacing.md,
                      paddingVertical: theme.spacing.xs,
                      opacity: pressed ? 0.6 : 1,
                    })}
                  >
                    <Icon name={row.icon} size={18} color={theme.colors.primary} />
                    <Text variant="body" style={{ flex: 1 }}>
                      {row.label}
                    </Text>
                    <Icon name="chevron-forward" size={18} color={theme.colors.textMuted} />
                  </Pressable>
                ))}
              </View>
              <Button
                title={t('clientDetail.addInbody')}
                variant="secondary"
                style={{ marginTop: theme.spacing.md }}
                left={<Icon name="add" size={18} color={theme.colors.text} />}
                onPress={() =>
                  router.push({ pathname: '/coach/body-metric', params: { clientId: id, clientName: name ?? '' } })
                }
              />
            </GlassCard>

            {/* Athlete feedback from logged workouts (migration 0021) */}
            {notes.length > 0 ? (
              <GlassCard>
                <Text variant="label" muted style={{ marginBottom: theme.spacing.sm }}>
                  {t('clientDetail.recentFeedback')}
                </Text>
                <View style={{ gap: theme.spacing.md }}>
                  {notes.map((n) => (
                    <View key={n.id} style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                        <Badge
                          label={n.category === 'challenge' ? t('workout.challenge') : t('workout.compliment')}
                          tone={n.category === 'challenge' ? 'warning' : 'success'}
                        />
                        {n.exercise_name ? (
                          <Text variant="caption" color="primary">
                            {n.exercise_name}
                          </Text>
                        ) : null}
                      </View>
                      <Text variant="body">{n.body}</Text>
                    </View>
                  ))}
                </View>
              </GlassCard>
            ) : null}

            <Button
              title={t('clientDetail.assignFromTemplates')}
              left={<Icon name="add" size={18} color={theme.colors.onPrimary} />}
              onPress={() => router.push('/coach/templates')}
            />

            <Text variant="label" muted style={{ marginTop: theme.spacing.sm }}>
              {t('clientDetail.assignedPlans')}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text variant="body" muted>
            {t('clientDetail.noPlans')}
          </Text>
        }
        renderItem={({ item }) => (
          <GlassCard onPress={() => router.push({ pathname: '/coach/plan/[id]', params: { id: item.id } })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
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
                <Icon name={item.type === 'training' ? 'barbell' : 'restaurant'} size={20} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="bodyStrong">{item.title}</Text>
                <Badge label={t(`planStatus.${item.status}`)} tone={STATUS_TONE[item.status]} />
              </View>
              <IconButton name="trash-outline" onPress={() => onDeletePlan(item)} />
              <Icon name="chevron-forward" size={20} color={theme.colors.textMuted} />
            </View>
          </GlassCard>
        )}
      />
    </Screen>

    {/* Plan-gen modal: pick training/nutrition + an optional steering prompt. The AI
        drafts it for THIS client; the coach lands in the editor to review + publish. */}
    <Modal visible={aiOpen} transparent animationType="slide" onRequestClose={() => setAiOpen(false)}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }} onPress={() => !aiBusy && setAiOpen(false)}>
          <Pressable
            onPress={Keyboard.dismiss}
            style={{
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: theme.radii.lg,
              borderTopRightRadius: theme.radii.lg,
              padding: theme.spacing.lg,
              paddingBottom: theme.spacing.xl,
              gap: theme.spacing.md,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
              <Icon name="sparkles" size={20} color={theme.colors.primary} />
              <Text variant="title" style={{ flex: 1 }}>
                {t('clientDetail.generateTitle')}
              </Text>
              <Pressable onPress={() => !aiBusy && setAiOpen(false)} hitSlop={8}>
                <Icon name="close" size={24} color={theme.colors.textMuted} />
              </Pressable>
            </View>
            <Text variant="caption" muted>
              {t('clientDetail.generateIntro', { name: name ?? t('clientDetail.thisClient') })}
            </Text>
            <Segmented
              value={aiType}
              onChange={(v) => {
                // Training and nutrition steer differently — don't carry one's prompt
                // into the other when the coach switches tabs.
                setAiType(v);
                setAiPrompt('');
              }}
              options={[
                { value: 'training', label: t('common.training') },
                { value: 'nutrition', label: t('common.nutrition') },
              ]}
            />
            <Input
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder={t('clientDetail.aiPromptPlaceholder')}
              editable={!aiBusy}
              multiline
              style={{ minHeight: 60, textAlignVertical: 'top' }}
            />
            {/* Quick-add chips: append proven phrases so the output is high quality. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {PROMPT_CHIP_KEYS[aiType].map((k) => {
                const phrase = t(`clientDetail.chips.${k}`);
                return <Chip key={k} label={`+ ${phrase}`} onPress={() => setAiPrompt((p) => appendChip(p, phrase))} />;
              })}
            </View>
            <Text variant="label" muted style={{ fontSize: 10 }}>
              {aiType === 'training' ? t('clientDetail.trainingNote') : t('clientDetail.nutritionNote')}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Button title={t('common.cancel')} variant="ghost" fullWidth={false} onPress={() => setAiOpen(false)} disabled={aiBusy} />
              <View style={{ flex: 1 }}>
                <Button title={t('clientDetail.generate')} onPress={onGenerate} loading={aiBusy} />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}
