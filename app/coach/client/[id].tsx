// Coach → one client's profile: progress snapshot + their assigned plans.
// Plans are assigned from templates (not created here); tapping one opens the editor.
// Progress stats are REAL (Phase 15): streak + this-week workouts come from completion
// logging (0016), adherence is workouts vs the athlete's training-days target (0017),
// and the lean-mass delta from verified InBody readings (0026).
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { listPlansForClient, type Plan } from '../../../src/lib/plans';
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
import { Icon, Screen, Text, Avatar, GlassCard, Badge, Button, Chip, DeltaChip, Input, Segmented } from '../../../src/components/ui';
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

function label(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

const STATUS_TONE = { draft: 'warning', published: 'success', archived: 'neutral' } as const;

// Quick-add prompt chips so coaches get high-quality AI output without typing much.
const PROMPT_CHIPS: Record<PlanType, string[]> = {
  training: ['Push/Pull/Legs split', 'Upper/Lower split', 'Full body', 'Knee-friendly', 'Minimal equipment', 'Progressive overload', 'Include core work'],
  nutrition: ['High protein', 'Budget-friendly', 'Quick to prepare', 'More vegetables', 'Low carb', 'Vegetarian'],
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
      const [p, g, t, d, w, s, n, m, o, ins, wk, sess] = await Promise.all([
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
      setNutTargets(t);
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
        plans: p, goals: g, nutTargets: t, nutDaily: d, nutWeek: w, nutStreak: s, notes: n, metrics: m, pendingOcr: o, nudge: ins?.analysis ?? null, streak: wk, sessions: sess,
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
        Alert.alert('Profile needed', 'This client hasn’t completed their profile yet, so the plan can’t be personalized.');
      } else if (res.status === 'rate_limited') {
        Alert.alert('Daily limit reached', 'You’ve generated the maximum number of AI plans today. Try again tomorrow.');
      } else {
        Alert.alert('Could not generate', 'The AI draft failed. Please try again.');
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
        Alert.alert('Not enough data', 'This client hasn’t logged enough workouts or nutrition yet for suggestions.');
      } else if (res.status === 'rate_limited') {
        Alert.alert('Daily limit reached', 'You’ve reached today’s suggestion limit. Try again tomorrow.');
      } else {
        Alert.alert('Could not analyze', 'The suggestion failed. Please try again.');
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
              <Avatar name={name ?? 'Client'} size={56} />
              <View style={{ flex: 1 }}>
                <Text variant="h2">{name ?? 'Client'}</Text>
                <Text variant="caption" muted>
                  Client
                </Text>
              </View>
            </View>

            {/* Progress snapshot (REAL — completion logging 0016 + verified InBody 0026) */}
            <GlassCard glowColor={theme.colors.primary}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.md }}>
                <Text variant="label" muted>
                  This week
                </Text>
                {realLeanDeltaKg != null ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Text variant="caption" muted>
                      Lean mass
                    </Text>
                    <DeltaChip value={realLeanDeltaKg} suffix=" kg" />
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row' }}>
                <MiniStat value={String(streak)} label="DAY STREAK" />
                <MiniStat value={String(workoutsThisWeek)} label="WORKOUTS" />
                <MiniStat value={adherencePct == null ? '—' : `${adherencePct}%`} label="ADHERENCE" />
              </View>
            </GlassCard>

            {/* Client goals (real data from athlete_profile, 0017) */}
            {goals?.onboarded_at ? (
              <GlassCard>
                <Text variant="label" muted style={{ marginBottom: theme.spacing.sm }}>
                  Goals
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                  {goals.primary_goal ? <Chip label={label(goals.primary_goal)} active /> : null}
                  {goals.experience_level ? <Chip label={label(goals.experience_level)} /> : null}
                  {goals.training_days != null ? <Chip label={`${goals.training_days} days/wk`} /> : null}
                  {goals.target_weight_grams ? <Chip label={`Target ${Math.round(goals.target_weight_grams / 1000)}kg`} /> : null}
                  {goals.dietary_tags.map((t) => (
                    <Chip key={t} label={label(t)} />
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
                  AI assistant
                </Text>
              </View>
              <Button
                title="Generate a plan with AI"
                variant="secondary"
                left={<Icon name="sparkles" size={16} color={theme.colors.text} />}
                onPress={() => setAiOpen(true)}
              />
              <View style={{ height: 1, backgroundColor: theme.colors.glassBorder, marginVertical: theme.spacing.md }} />
              <Text variant="caption" muted style={{ marginBottom: theme.spacing.sm }}>
                Plan adjustments — private suggestions from this client’s recent logging. Only you see these.
              </Text>
              {nudge ? (
                <Text variant="body" style={{ marginBottom: theme.spacing.sm }}>
                  {nudge}
                </Text>
              ) : null}
              <Input
                value={nudgePrompt}
                onChangeText={setNudgePrompt}
                placeholder="Optional: steer the suggestions (e.g. focus on nutrition)"
                editable={!nudgeBusy}
              />
              <Button
                title={nudge ? 'Refresh suggestions' : 'Suggest plan adjustments'}
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
                  Nutrition
                </Text>
                {nutTargets ? (
                  <Text variant="caption" muted>
                    Today {nutDaily?.kcal_total ?? 0} / {nutTargets.kcal_target} kcal
                  </Text>
                ) : null}
              </View>
              {nutWeek && (nutWeek.daysLogged > 0 || nutTargets) ? (
                <View style={{ flexDirection: 'row' }}>
                  <MiniStat value={String(nutStreak)} label="LOG STREAK" />
                  <MiniStat value={`${nutWeek.daysLogged}/7`} label="DAYS LOGGED" />
                  <MiniStat value={String(nutWeek.average.kcal)} label="AVG KCAL" />
                </View>
              ) : (
                <Text variant="caption" muted>
                  No nutrition logged yet.
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
                    Pending InBody readings
                  </Text>
                  <Badge label={String(pendingOcr.length)} tone="warning" />
                </View>
                <Text variant="caption" muted style={{ marginBottom: theme.spacing.sm }}>
                  Auto-read from the client’s scans. Review each against the sheet and confirm to count it.
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
                          {Math.round(m.weight_grams / 100) / 10} kg
                          {m.body_fat_bp != null ? ` · ${Math.round(m.body_fat_bp / 10) / 10}% fat` : ''}
                        </Text>
                        <Text variant="caption" muted>
                          {new Date(m.measured_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </Text>
                      </View>
                      <Text variant="caption" color="warning">
                        Review
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
                Progress
              </Text>
              <View style={{ gap: theme.spacing.sm }}>
                {[
                  { icon: 'body' as const, label: 'Body composition', route: '/client/progress/body-comp' as const },
                  { icon: 'trending-up' as const, label: 'Weight history', route: '/client/progress/weight' as const },
                  { icon: 'camera' as const, label: 'Progress photos', route: '/client/progress/photos' as const },
                  { icon: 'document-text' as const, label: 'InBody scans', route: '/client/progress/inbody' as const },
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
                title="Add InBody reading"
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
                  Recent feedback
                </Text>
                <View style={{ gap: theme.spacing.md }}>
                  {notes.map((n) => (
                    <View key={n.id} style={{ gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                        <Badge
                          label={n.category === 'challenge' ? 'Challenge' : 'Compliment'}
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
              title="Assign from templates"
              left={<Icon name="add" size={18} color={theme.colors.onPrimary} />}
              onPress={() => router.push('/coach/templates')}
            />

            <Text variant="label" muted style={{ marginTop: theme.spacing.sm }}>
              Assigned plans
            </Text>
          </View>
        }
        ListEmptyComponent={
          <Text variant="body" muted>
            No plans assigned yet.
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
                <Badge label={item.status} tone={STATUS_TONE[item.status]} />
              </View>
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
                Generate a plan
              </Text>
              <Pressable onPress={() => !aiBusy && setAiOpen(false)} hitSlop={8}>
                <Icon name="close" size={24} color={theme.colors.textMuted} />
              </Pressable>
            </View>
            <Text variant="caption" muted>
              A draft is created from {name ?? 'this client'}’s goals and preferences. You review and edit it before publishing.
            </Text>
            <Segmented
              value={aiType}
              onChange={(t) => {
                // Training and nutrition steer differently — don't carry one's prompt
                // into the other when the coach switches tabs.
                setAiType(t);
                setAiPrompt('');
              }}
              options={[
                { value: 'training', label: 'Training' },
                { value: 'nutrition', label: 'Nutrition' },
              ]}
            />
            <Input
              value={aiPrompt}
              onChangeText={setAiPrompt}
              placeholder="Optional — tap a chip below or type your own"
              editable={!aiBusy}
              multiline
              style={{ minHeight: 60, textAlignVertical: 'top' }}
            />
            {/* Quick-add chips: append proven phrases so the output is high quality. */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {PROMPT_CHIPS[aiType].map((c) => (
                <Chip key={c} label={`+ ${c}`} onPress={() => setAiPrompt((p) => appendChip(p, c))} />
              ))}
            </View>
            <Text variant="label" muted style={{ fontSize: 10 }}>
              {aiType === 'training'
                ? 'Drafts one week sized to their training days. Duplicate or “Adjust with AI” in the editor to extend.'
                : 'Drafts one day of meals toward their macro target.'}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
              <Button title="Cancel" variant="ghost" fullWidth={false} onPress={() => setAiOpen(false)} disabled={aiBusy} />
              <View style={{ flex: 1 }}>
                <Button title="Generate" onPress={onGenerate} loading={aiBusy} />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
    </>
  );
}
