// Client → read-only view of an assigned plan. RLS returns the plan + its
// children only if it's a non-draft plan assigned to this client, so there is no
// edit surface. Training: days → block-grouped exercises with the coach's cues.
// Nutrition: meals → foods with per-meal + plan macro totals.
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import {
  getPlan,
  listDays,
  listExerciseRows,
  listMealItems,
  listMeals,
  type Day,
  type ExerciseRow,
  type Meal,
  type MealItem,
  type Plan,
} from '../../../src/lib/plans';
import {
  addMacros,
  BLOCK_LABEL,
  BLOCK_ORDER,
  EMPTY_MACROS,
  sumMacros,
  type Macros,
} from '../../../src/lib/plan-ui';

export default function ClientPlanView() {
  const { role } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [exByDay, setExByDay] = useState<Record<string, ExerciseRow[]>>({});
  const [meals, setMeals] = useState<Meal[]>([]);
  const [itemsByMeal, setItemsByMeal] = useState<Record<string, MealItem[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const p = await getPlan(id);
      setPlan(p);
      if (!p) return;
      if (p.type === 'training') {
        const ds = await listDays(id);
        setDays(ds);
        const entries = await Promise.all(
          ds.map(async (d) => [d.id, await listExerciseRows(d.id)] as const),
        );
        setExByDay(Object.fromEntries(entries));
      } else {
        const ms = await listMeals(id);
        setMeals(ms);
        const entries = await Promise.all(
          ms.map(async (m) => [m.id, await listMealItems(m.id)] as const),
        );
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

  if (role && role !== 'client') return <Redirect href="/" />;
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!plan) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>This plan isn’t available.</Text>
      </View>
    );
  }

  const planMacros: Macros = meals.reduce(
    (acc, m) => addMacros(acc, sumMacros(itemsByMeal[m.id] ?? [])),
    EMPTY_MACROS,
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.title}>{plan.title}</Text>
        <Text style={styles.type}>{plan.type}</Text>

        {plan.type === 'nutrition' && meals.length > 0 ? (
          <View style={styles.totalCard}>
            <Text style={styles.totalLabel}>DAILY TOTAL</Text>
            <Text style={styles.totalMacros}>
              {planMacros.kcal} kcal · {planMacros.protein}P / {planMacros.carbs}C / {planMacros.fat}F
            </Text>
          </View>
        ) : null}

        {plan.type === 'training'
          ? days.map((d) => {
              const ex = exByDay[d.id] ?? [];
              return (
                <View key={d.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{d.name}</Text>
                  {ex.length === 0 ? <Text style={styles.muted}>No exercises.</Text> : null}
                  {BLOCK_ORDER.filter((b) => ex.some((e) => e.block === b)).map((b) => (
                    <View key={b}>
                      <Text style={styles.blockLabel}>{BLOCK_LABEL[b]}</Text>
                      {ex
                        .filter((e) => e.block === b)
                        .map((e) => (
                          <View key={e.id} style={styles.itemRow}>
                            <Text style={styles.itemName}>{e.exercise_name}</Text>
                            <Text style={styles.itemMeta}>
                              {[
                                e.sets != null ? `${e.sets}×${e.reps ?? '—'}` : e.reps ?? null,
                                e.rest_seconds != null ? `${e.rest_seconds}s rest` : null,
                                e.tempo ? `tempo ${e.tempo}` : null,
                              ]
                                .filter(Boolean)
                                .join('  ·  ')}
                            </Text>
                            {e.note ? <Text style={styles.note}>“{e.note}”</Text> : null}
                          </View>
                        ))}
                    </View>
                  ))}
                </View>
              );
            })
          : meals.map((m) => {
              const items = itemsByMeal[m.id] ?? [];
              const mm = sumMacros(items);
              return (
                <View key={m.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{m.name}</Text>
                  {items.length > 0 ? (
                    <Text style={styles.mealMacros}>
                      {mm.kcal} kcal · {mm.protein}P / {mm.carbs}C / {mm.fat}F
                    </Text>
                  ) : (
                    <Text style={styles.muted}>No foods.</Text>
                  )}
                  {m.note ? <Text style={styles.note}>“{m.note}”</Text> : null}
                  {items.map((it) => (
                    <View key={it.id} style={styles.itemRow}>
                      <Text style={styles.itemName}>
                        {it.food_name} · {it.grams} g
                      </Text>
                      {it.note ? <Text style={styles.note}>“{it.note}”</Text> : null}
                    </View>
                  ))}
                </View>
              );
            })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  wrap: { padding: 16, gap: 10 },
  title: { fontSize: 24, fontWeight: '800', color: '#111' },
  type: { fontSize: 14, color: '#6e7781', textTransform: 'capitalize' },
  totalCard: { backgroundColor: '#eef6ff', borderRadius: 12, padding: 12, marginTop: 4 },
  totalLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: '#1f6feb' },
  totalMacros: { fontSize: 15, fontWeight: '700', color: '#111', marginTop: 2 },
  card: { backgroundColor: '#f5f6f8', borderRadius: 14, padding: 14, gap: 2, marginTop: 6 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  mealMacros: { fontSize: 13, color: '#1f6feb', fontWeight: '600' },
  blockLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#6e7781',
    marginTop: 8,
    textTransform: 'uppercase',
  },
  itemRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  itemName: { fontSize: 15, fontWeight: '600', color: '#111' },
  itemMeta: { fontSize: 13, color: '#6e7781', marginTop: 1 },
  note: { fontSize: 13, color: '#1f6feb', fontStyle: 'italic', marginTop: 3 },
  muted: { fontSize: 13, color: '#888', marginTop: 4 },
  empty: { fontSize: 15, color: '#888' },
});
