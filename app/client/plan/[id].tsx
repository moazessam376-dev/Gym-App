// Client → read-only view of an assigned plan. RLS returns the plan + its children
// only if it's a non-draft plan assigned to this client. Training: Weeks → Days →
// block-grouped exercises with the coach's cues. Nutrition: meals → foods + macros.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/lib/auth-context';
import { textStart } from '../../../src/lib/rtl';
import {
  getPlan,
  listDays,
  listExerciseRows,
  listMealItems,
  listMeals,
  listWeeks,
  type Day,
  type ExerciseRow,
  type Meal,
  type MealItem,
  type Plan,
  type Week,
} from '../../../src/lib/plans';
import { addMacros, BLOCK_LABEL, BLOCK_ORDER, EMPTY_MACROS, sumMacros, type Macros } from '../../../src/lib/plan-ui';
import { Screen, Text, Card, GlassCard, Badge, Button } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

function CoachNote({ text }: { text: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: theme.spacing.sm,
        backgroundColor: 'rgba(61,90,254,0.12)',
        borderRadius: theme.radii.sm,
        padding: theme.spacing.md,
        marginTop: theme.spacing.sm,
      }}
    >
      <Ionicons name="chatbubble-ellipses" size={15} color={theme.colors.primary} />
      <Text variant="caption" color="link" style={{ flex: 1, fontStyle: 'italic' }}>
        {text}
      </Text>
    </View>
  );
}

export default function ClientPlanView() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [weekId, setWeekId] = useState<string | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [exByDay, setExByDay] = useState<Record<string, ExerciseRow[]>>({});
  const [meals, setMeals] = useState<Meal[]>([]);
  const [itemsByMeal, setItemsByMeal] = useState<Record<string, MealItem[]>>({});
  const [loading, setLoading] = useState(true);

  const loadWeekDays = useCallback(async (wid: string) => {
    const ds = await listDays(wid);
    setDays(ds);
    const entries = await Promise.all(ds.map(async (d) => [d.id, await listExerciseRows(d.id)] as const));
    setExByDay(Object.fromEntries(entries));
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const p = await getPlan(id);
      setPlan(p);
      if (!p) return;
      if (p.type === 'training') {
        const ws = await listWeeks(id);
        setWeeks(ws);
        setWeekId((prev) => (ws.some((w) => w.id === prev) ? prev : ws[0]?.id ?? null));
      } else {
        const ms = await listMeals(id);
        setMeals(ms);
        const entries = await Promise.all(ms.map(async (m) => [m.id, await listMealItems(m.id)] as const));
        setItemsByMeal(Object.fromEntries(entries));
      }
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

  useEffect(() => {
    if (weekId) loadWeekDays(weekId).catch(() => {});
    else {
      setDays([]);
      setExByDay({});
    }
  }, [weekId, loadWeekDays]);

  if (role && role !== 'client') return <Redirect href="/" />;
  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  if (!plan) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <Text variant="body" muted>
          {t('planView.unavailable')}
        </Text>
      </View>
    );
  }

  const isTraining = plan.type === 'training';
  const planMacros: Macros = meals.reduce(
    (acc, m) => addMacros(acc, sumMacros(itemsByMeal[m.id] ?? [])),
    EMPTY_MACROS,
  );

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
        <View>
          <Text variant="h1">{plan.title}</Text>
          <Text variant="caption" muted style={textStart}>
            {t(`common.${plan.type}`)}
          </Text>
        </View>

        {plan.note ? <CoachNote text={plan.note} /> : null}

        {!isTraining && meals.length > 0 ? (
          <GlassCard>
            <Text variant="label" color="primary">
              {t('planView.dailyTotal')}
            </Text>
            <Text variant="title" style={{ marginTop: 2 }}>
              {t('planView.macroLine', {
                kcal: planMacros.kcal,
                p: planMacros.protein,
                c: planMacros.carbs,
                f: planMacros.fat,
              })}
            </Text>
          </GlassCard>
        ) : null}

        {/* Week selector (training only) */}
        {isTraining && weeks.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.spacing.sm, paddingVertical: theme.spacing.xs }}>
            {weeks.map((w) => {
              const active = w.id === weekId;
              return (
                <Pressable
                  key={w.id}
                  onPress={() => setWeekId(w.id)}
                  style={{
                    borderRadius: theme.radii.full,
                    paddingHorizontal: theme.spacing.lg,
                    paddingVertical: theme.spacing.sm,
                    backgroundColor: active ? theme.colors.primary : theme.colors.glass,
                    borderWidth: 1,
                    borderColor: active ? theme.colors.primary : theme.colors.glassBorder,
                  }}
                >
                  <Text variant="caption" color={active ? theme.colors.onPrimary : theme.colors.textMuted} style={{ fontFamily: theme.fontFamily.bodyBold }}>
                    {w.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {isTraining
          ? days.map((d) => {
              const ex = exByDay[d.id] ?? [];
              return (
                <Card key={d.id} style={{ gap: theme.spacing.xs }}>
                  <Text variant="title">{d.name}</Text>
                  {d.note ? <CoachNote text={d.note} /> : null}
                  {ex.length === 0 ? (
                    <Text variant="caption" muted>
                      {t('planView.noExercises')}
                    </Text>
                  ) : null}
                  {BLOCK_ORDER.filter((b) => ex.some((e) => e.block === b)).map((b) => (
                    <View key={b}>
                      <Text variant="label" muted style={{ marginTop: theme.spacing.md }}>
                        {BLOCK_LABEL[b]}
                      </Text>
                      {ex
                        .filter((e) => e.block === b)
                        .map((e) => (
                          <View
                            key={e.id}
                            style={{
                              backgroundColor: theme.colors.glass,
                              borderRadius: theme.radii.sm,
                              padding: theme.spacing.md,
                              marginTop: theme.spacing.sm,
                            }}
                          >
                            <Text variant="bodyStrong">{e.exercise_name}</Text>
                            <Text variant="caption" muted style={{ marginTop: 1 }}>
                              {[
                                e.sets != null ? `${e.sets}×${e.reps ?? '—'}` : e.reps ?? null,
                                e.rest_seconds != null ? t('planView.restShort', { n: e.rest_seconds }) : null,
                                e.tempo ? t('planView.tempoShort', { tempo: e.tempo }) : null,
                              ]
                                .filter(Boolean)
                                .join('  ·  ')}
                            </Text>
                            {e.note ? <CoachNote text={e.note} /> : null}
                          </View>
                        ))}
                    </View>
                  ))}
                  {ex.length > 0 ? (
                    <Button
                      title={t('planView.logWorkout')}
                      left={<Ionicons name="barbell" size={18} color={theme.colors.onPrimary} />}
                      style={{ marginTop: theme.spacing.md }}
                      onPress={() =>
                        router.push({
                          pathname: '/client/workout/[dayId]',
                          params: { dayId: d.id, planId: plan.id, name: d.name },
                        })
                      }
                    />
                  ) : null}
                </Card>
              );
            })
          : meals.map((m) => {
              const items = itemsByMeal[m.id] ?? [];
              const mm = sumMacros(items);
              return (
                <Card key={m.id} style={{ gap: theme.spacing.xs }}>
                  <Text variant="title">{m.name}</Text>
                  {items.length > 0 ? (
                    <Text variant="caption" color="link" style={{ fontFamily: theme.fontFamily.bodySemiBold }}>
                      {t('planView.macroLine', { kcal: mm.kcal, p: mm.protein, c: mm.carbs, f: mm.fat })}
                    </Text>
                  ) : (
                    <Text variant="caption" muted>
                      {t('planView.noFoods')}
                    </Text>
                  )}
                  {m.note ? <CoachNote text={m.note} /> : null}
                  {items.map((it) => (
                    <View
                      key={it.id}
                      style={{
                        backgroundColor: theme.colors.glass,
                        borderRadius: theme.radii.sm,
                        padding: theme.spacing.md,
                        marginTop: theme.spacing.sm,
                      }}
                    >
                      <Text variant="bodyStrong">
                        {t('planView.foodLine', { name: it.food_name, grams: it.grams })}
                      </Text>
                      {it.note ? <CoachNote text={it.note} /> : null}
                    </View>
                  ))}
                </Card>
              );
            })}
      </ScrollView>
    </Screen>
  );
}
