// Coach → plan editor. One screen for both a TEMPLATE (no client → "Assign to
// client") and an ASSIGNED plan (→ publish/unpublish). Branches on plan.type:
// training = days → block-grouped exercises; nutrition = meals → food items with
// macro totals. All writes are RLS-gated (can_write_plan / _day / _meal).
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import {
  createDay,
  createMeal,
  deleteDay,
  deleteMeal,
  getPlan,
  listDays,
  listExerciseRows,
  listMealItems,
  listMeals,
  setPlanStatus,
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
  PLAN_STATUS_STYLE,
  sumMacros,
  type Macros,
} from '../../../src/lib/plan-ui';

export default function PlanEditor() {
  const { role } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [exByDay, setExByDay] = useState<Record<string, ExerciseRow[]>>({});
  const [meals, setMeals] = useState<Meal[]>([]);
  const [itemsByMeal, setItemsByMeal] = useState<Record<string, MealItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

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

  if (role && role !== 'coach') return <Redirect href="/" />;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!plan || !id) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Plan not found.</Text>
      </View>
    );
  }

  const isTemplate = plan.client_id === null;
  const published = plan.status === 'published';

  async function onAddContainer() {
    if (!id || newName.trim().length === 0) return;
    setBusy(true);
    try {
      if (plan!.type === 'training') {
        await createDay({ plan_id: id, name: newName.trim(), position: days.length });
      } else {
        await createMeal({ plan_id: id, name: newName.trim(), position: meals.length });
      }
      setNewName('');
      await load();
    } catch {
      Alert.alert('Error', 'Could not add. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function confirmDeleteContainer(kind: 'day' | 'meal', cid: string, name: string) {
    Alert.alert(`Delete ${kind}`, `Delete "${name}" and everything in it?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            if (kind === 'day') await deleteDay(cid);
            else await deleteMeal(cid);
            await load();
          } catch {
            Alert.alert('Error', 'Could not delete.');
          }
        },
      },
    ]);
  }

  async function onTogglePublish() {
    if (!plan) return;
    setBusy(true);
    try {
      await setPlanStatus(plan.id, published ? 'draft' : 'published');
      await load();
    } catch {
      Alert.alert('Error', 'Could not update status.');
    } finally {
      setBusy(false);
    }
  }

  const planMacros: Macros = meals.reduce(
    (acc, m) => addMacros(acc, sumMacros(itemsByMeal[m.id] ?? [])),
    EMPTY_MACROS,
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{plan.title}</Text>
            <View style={[styles.status, isTemplate ? styles.template : PLAN_STATUS_STYLE[plan.status]]}>
              <Text style={styles.statusText}>{isTemplate ? 'template' : plan.status}</Text>
            </View>
          </View>
          <Text style={styles.type}>{plan.type}</Text>

          {isTemplate ? (
            <Pressable
              style={[styles.headerBtn, styles.assign]}
              onPress={() => router.push({ pathname: '/coach/assign/[id]', params: { id: plan.id } })}
            >
              <Text style={styles.headerBtnText}>Assign to a client</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.headerBtn, published ? styles.unpublish : styles.publish]}
              onPress={onTogglePublish}
              disabled={busy}
            >
              <Text style={styles.headerBtnText}>
                {published ? 'Unpublish (back to draft)' : 'Publish to client'}
              </Text>
            </Pressable>
          )}

          {/* Nutrition plan total */}
          {plan.type === 'nutrition' && meals.length > 0 ? (
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>PLAN TOTAL</Text>
              <Text style={styles.totalMacros}>
                {planMacros.kcal} kcal · {planMacros.protein}P / {planMacros.carbs}C / {planMacros.fat}F
              </Text>
            </View>
          ) : null}

          {/* Body */}
          {plan.type === 'training'
            ? days.map((d) => (
                <DayCard
                  key={d.id}
                  day={d}
                  exercises={exByDay[d.id] ?? []}
                  onAddExercise={() =>
                    router.push({ pathname: '/coach/exercise-picker', params: { dayId: d.id } })
                  }
                  onOpenExercise={(rowId) =>
                    router.push({ pathname: '/coach/exercise/[id]', params: { id: rowId } })
                  }
                  onDelete={() => confirmDeleteContainer('day', d.id, d.name)}
                />
              ))
            : meals.map((m) => (
                <MealCard
                  key={m.id}
                  meal={m}
                  items={itemsByMeal[m.id] ?? []}
                  onAddFood={() =>
                    router.push({ pathname: '/coach/food-picker', params: { mealId: m.id } })
                  }
                  onOpenItem={(itemId) =>
                    router.push({ pathname: '/coach/meal-item/[id]', params: { id: itemId } })
                  }
                  onDelete={() => confirmDeleteContainer('meal', m.id, m.name)}
                />
              ))}

          {/* Add day / meal */}
          <View style={styles.addBox}>
            <TextInput
              style={styles.input}
              value={newName}
              onChangeText={setNewName}
              placeholder={plan.type === 'training' ? 'New day (e.g. Day 1 - Push)' : 'New meal (e.g. Breakfast)'}
              editable={!busy}
            />
            <Pressable style={styles.addBtn} onPress={onAddContainer} disabled={busy}>
              <Text style={styles.addBtnText}>Add {plan.type === 'training' ? 'day' : 'meal'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function DayCard({
  day,
  exercises,
  onAddExercise,
  onOpenExercise,
  onDelete,
}: {
  day: Day;
  exercises: ExerciseRow[];
  onAddExercise: () => void;
  onOpenExercise: (rowId: string) => void;
  onDelete: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{day.name}</Text>
        <Pressable hitSlop={10} onPress={onDelete}>
          <Text style={styles.remove}>✕</Text>
        </Pressable>
      </View>
      {BLOCK_ORDER.filter((b) => exercises.some((e) => e.block === b)).map((b) => (
        <View key={b}>
          <Text style={styles.blockLabel}>{BLOCK_LABEL[b]}</Text>
          {exercises
            .filter((e) => e.block === b)
            .map((e) => (
              <Pressable key={e.id} style={styles.exRow} onPress={() => onOpenExercise(e.id)}>
                <Text style={styles.exName}>{e.exercise_name}</Text>
                <Text style={styles.exMeta}>
                  {[e.sets != null ? `${e.sets}×${e.reps ?? '—'}` : null, e.rest_seconds != null ? `${e.rest_seconds}s rest` : null]
                    .filter(Boolean)
                    .join('  ·  ') || 'tap to set details'}
                </Text>
              </Pressable>
            ))}
        </View>
      ))}
      <Pressable style={styles.addInline} onPress={onAddExercise}>
        <Text style={styles.addInlineText}>＋ Add exercise</Text>
      </Pressable>
    </View>
  );
}

function MealCard({
  meal,
  items,
  onAddFood,
  onOpenItem,
  onDelete,
}: {
  meal: Meal;
  items: MealItem[];
  onAddFood: () => void;
  onOpenItem: (itemId: string) => void;
  onDelete: () => void;
}) {
  const macros = sumMacros(items);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{meal.name}</Text>
        <Pressable hitSlop={10} onPress={onDelete}>
          <Text style={styles.remove}>✕</Text>
        </Pressable>
      </View>
      {items.length > 0 ? (
        <Text style={styles.mealMacros}>
          {macros.kcal} kcal · {macros.protein}P / {macros.carbs}C / {macros.fat}F
        </Text>
      ) : null}
      {items.map((it) => (
        <Pressable key={it.id} style={styles.exRow} onPress={() => onOpenItem(it.id)}>
          <Text style={styles.exName}>{it.food_name}</Text>
          <Text style={styles.exMeta}>{it.grams} g</Text>
        </Pressable>
      ))}
      <Pressable style={styles.addInline} onPress={onAddFood}>
        <Text style={styles.addInlineText}>＋ Add food</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  wrap: { padding: 16, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 24, fontWeight: '800', color: '#111' },
  type: { fontSize: 14, color: '#6e7781', textTransform: 'capitalize' },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  template: { backgroundColor: '#6f42c1' },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  headerBtn: { borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  assign: { backgroundColor: '#6f42c1' },
  publish: { backgroundColor: '#1a7f37' },
  unpublish: { backgroundColor: '#9a6700' },
  headerBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  totalCard: { backgroundColor: '#eef6ff', borderRadius: 12, padding: 12, marginTop: 4 },
  totalLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: '#1f6feb' },
  totalMacros: { fontSize: 15, fontWeight: '700', color: '#111', marginTop: 2 },
  card: { backgroundColor: '#f5f6f8', borderRadius: 14, padding: 14, gap: 4, marginTop: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: '#111' },
  remove: { fontSize: 17, color: '#cf222e', fontWeight: '700' },
  blockLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#6e7781',
    marginTop: 8,
    textTransform: 'uppercase',
  },
  mealMacros: { fontSize: 13, color: '#1f6feb', fontWeight: '600', marginBottom: 2 },
  exRow: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
  },
  exName: { fontSize: 15, fontWeight: '600', color: '#111' },
  exMeta: { fontSize: 13, color: '#6e7781', marginTop: 1 },
  addInline: { paddingVertical: 10, marginTop: 4 },
  addInlineText: { color: '#1f6feb', fontWeight: '600', fontSize: 15 },
  addBox: { gap: 8, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  addBtn: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  empty: { fontSize: 15, color: '#888' },
});
