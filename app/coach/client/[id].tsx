// Coach → one client's profile: progress snapshot + their assigned plans.
// Plans are assigned from templates (not created here); tapping one opens the editor.
// Progress stats are DEMO data (see src/mock/dashboard.ts) until completion logging
// is live (streak/adherence) and the InBody system lands (lean-mass delta).
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { listPlansForClient, type Plan } from '../../../src/lib/plans';
import { getAthleteProfileFor, type AthleteProfile } from '../../../src/lib/athlete-profile';
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
import { Screen, Text, Avatar, GlassCard, Badge, Button, Chip, DeltaChip } from '../../../src/components/ui';
import { theme } from '../../../src/theme';
import { IS_DEMO_DATA, MOCK_CLIENT_PROGRESS as P } from '../../../src/mock/dashboard';

function label(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

const STATUS_TONE = { draft: 'warning', published: 'success', archived: 'neutral' } as const;

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text variant="h2">{value}</Text>
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

  const [plans, setPlans] = useState<Plan[]>([]);
  const [goals, setGoals] = useState<AthleteProfile | null>(null);
  const [nutTargets, setNutTargets] = useState<NutritionTargets | null>(null);
  const [nutDaily, setNutDaily] = useState<DailyNutrition | null>(null);
  const [nutWeek, setNutWeek] = useState<WeekNutrition | null>(null);
  const [nutStreak, setNutStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const today = todayLocalDate();
      const [p, g, t, d, w, s] = await Promise.all([
        listPlansForClient(id),
        getAthleteProfileFor(id),
        getTargets(id),
        getDailyNutrition(id, today),
        getWeekNutrition(id, today),
        getNutritionStreak(id),
      ]);
      setPlans(p);
      setGoals(g);
      setNutTargets(t);
      setNutDaily(d);
      setNutWeek(w);
      setNutStreak(s);
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

  if (role && role !== 'coach') return <Redirect href="/" />;
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
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

            {/* Progress snapshot (DEMO) */}
            <GlassCard glowColor={theme.colors.primary}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.md }}>
                <Text variant="label" muted>
                  This week
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <Text variant="caption" muted>
                    Lean mass
                  </Text>
                  <DeltaChip value={P.leanMassDelta} />
                  {IS_DEMO_DATA ? (
                    <Text variant="label" muted style={{ fontSize: 9, opacity: 0.6 }}>
                      SAMPLE
                    </Text>
                  ) : null}
                </View>
              </View>
              <View style={{ flexDirection: 'row' }}>
                <MiniStat value={`${P.streak}🔥`} label="DAY STREAK" />
                <MiniStat value={String(P.workoutsThisWeek)} label="WORKOUTS" />
                <MiniStat value={`${P.adherencePct}%`} label="ADHERENCE" />
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
                  <MiniStat value={`${nutStreak}🔥`} label="LOG STREAK" />
                  <MiniStat value={`${nutWeek.daysLogged}/7`} label="DAYS LOGGED" />
                  <MiniStat value={String(nutWeek.average.kcal)} label="AVG KCAL" />
                </View>
              ) : (
                <Text variant="caption" muted>
                  No nutrition logged yet.
                </Text>
              )}
            </GlassCard>

            <Button
              title="Assign from templates"
              left={<Ionicons name="add" size={18} color={theme.colors.onPrimary} />}
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
                <Ionicons name={item.type === 'training' ? 'barbell' : 'restaurant'} size={20} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="bodyStrong">{item.title}</Text>
                <Badge label={item.status} tone={STATUS_TONE[item.status]} />
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
            </View>
          </GlassCard>
        )}
      />
    </Screen>
  );
}
