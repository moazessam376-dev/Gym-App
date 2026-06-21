// Coach → plan editor. TEMPLATE (no client → "Assign to client") or ASSIGNED plan
// (→ publish/unpublish). Training = Weeks → Days → block-grouped exercises with
// 3-level coach comments (plan / day / exercise) and editable titles + day order;
// nutrition = Meals → food items with macro totals. All writes are RLS-gated.
import { useCallback, useEffect, useRef, useState } from 'react';
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
import { confirmDestructive } from '../../../src/lib/confirm';
import {
  createDay,
  createMeal,
  createWeek,
  deleteDay,
  deleteMeal,
  deleteWeek,
  duplicateWeek,
  getPlan,
  listDays,
  listExerciseRows,
  listMealItems,
  listMeals,
  listWeeks,
  setPlanStatus,
  updateDay,
  updatePlan,
  type Day,
  type ExerciseRow,
  type Meal,
  type MealItem,
  type Plan,
  type Week,
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
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [weekId, setWeekId] = useState<string | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [exByDay, setExByDay] = useState<Record<string, ExerciseRow[]>>({});
  const [meals, setMeals] = useState<Meal[]>([]);
  const [itemsByMeal, setItemsByMeal] = useState<Record<string, MealItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const loadWeekDays = useCallback(async (wid: string) => {
    const ds = await listDays(wid);
    setDays(ds);
    const entries = await Promise.all(ds.map(async (d) => [d.id, await listExerciseRows(d.id)] as const));
    setExByDay(Object.fromEntries(entries));
  }, []);

  // Mirror weekId in a ref so load() can keep the current selection WITHOUT
  // depending on weekId — depending on it would recreate load + re-fire
  // useFocusEffect on every selection (the "weeks switch on their own" loop).
  // load() reloads the active week's days each focus, so a freshly-added exercise
  // shows when you return from the picker (the week didn't change).
  const weekIdRef = useRef<string | null>(null);
  useEffect(() => {
    weekIdRef.current = weekId;
  }, [weekId]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const p = await getPlan(id);
      setPlan(p);
      if (!p) return;
      if (p.type === 'training') {
        const ws = await listWeeks(id);
        setWeeks(ws);
        const active = ws.some((w) => w.id === weekIdRef.current) ? weekIdRef.current : ws[0]?.id ?? null;
        setWeekId(active);
        if (active) await loadWeekDays(active);
        else {
          setDays([]);
          setExByDay({});
        }
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
  }, [id, loadWeekDays]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const selectWeek = useCallback(
    async (wid: string) => {
      setWeekId(wid);
      try {
        await loadWeekDays(wid);
      } catch {
        /* keep prior */
      }
    },
    [loadWeekDays],
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
  const isTraining = plan.type === 'training';

  async function refreshWeeks(selectId?: string) {
    const ws = await listWeeks(id!);
    setWeeks(ws);
    const target = selectId ?? (ws.some((w) => w.id === weekIdRef.current) ? weekIdRef.current : ws[0]?.id ?? null);
    setWeekId(target);
    if (target) await loadWeekDays(target);
    else {
      setDays([]);
      setExByDay({});
    }
  }

  async function onAddWeek() {
    setBusy(true);
    try {
      const w = await createWeek({ plan_id: id!, name: `Week ${weeks.length + 1}`, position: weeks.length });
      await refreshWeeks(w.id);
    } catch {
      Alert.alert('Error', 'Could not add a week.');
    } finally {
      setBusy(false);
    }
  }

  async function onDuplicateWeek() {
    if (!weekId) return;
    setBusy(true);
    try {
      const newWeek = await duplicateWeek(weekId);
      await refreshWeeks(newWeek);
    } catch {
      Alert.alert('Error', 'Could not duplicate the week.');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteWeek() {
    if (!weekId) return;
    if (weeks.length <= 1) {
      Alert.alert('Keep one week', 'A plan needs at least one week.');
      return;
    }
    if (!(await confirmDestructive('Delete week', 'Delete this week and all its days?'))) return;
    setBusy(true);
    try {
      await deleteWeek(weekId);
      await refreshWeeks();
    } catch {
      Alert.alert('Error', 'Could not delete the week.');
    } finally {
      setBusy(false);
    }
  }

  async function onAddContainer() {
    if (newName.trim().length === 0) return;
    if (isTraining && !weekId) return;
    setBusy(true);
    try {
      if (isTraining) {
        await createDay({ plan_id: id!, week_id: weekId!, name: newName.trim(), position: days.length });
        await loadWeekDays(weekId!);
      } else {
        await createMeal({ plan_id: id!, name: newName.trim(), position: meals.length });
        await load();
      }
      setNewName('');
    } catch {
      Alert.alert('Error', 'Could not add. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteDay(dayId: string, name: string) {
    if (!(await confirmDestructive('Delete day', `Delete "${name}" and everything in it?`))) return;
    try {
      await deleteDay(dayId);
      if (weekId) await loadWeekDays(weekId);
    } catch {
      Alert.alert('Error', 'Could not delete.');
    }
  }

  async function onDeleteMeal(mealId: string, name: string) {
    if (!(await confirmDestructive('Delete meal', `Delete "${name}" and everything in it?`))) return;
    try {
      await deleteMeal(mealId);
      await load();
    } catch {
      Alert.alert('Error', 'Could not delete.');
    }
  }

  // Reorder a day by swapping its position with its neighbour (functional
  // stand-in for drag-and-drop, which comes in the UI redesign).
  async function moveDay(day: Day, dir: 'up' | 'down') {
    const idx = days.findIndex((d) => d.id === day.id);
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= days.length || !weekId) return;
    const other = days[swapIdx];
    setBusy(true);
    try {
      await updateDay(day.id, { position: other.position });
      await updateDay(other.id, { position: day.position });
      await loadWeekDays(weekId);
    } catch {
      Alert.alert('Error', 'Could not reorder.');
    } finally {
      setBusy(false);
    }
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

  async function savePlanTitle(text: string) {
    if (!plan) return;
    await updatePlan(plan.id, { title: text.trim() });
    setPlan(await getPlan(plan.id));
  }

  async function savePlanNote(text: string) {
    if (!plan) return;
    await updatePlan(plan.id, { note: text.trim() === '' ? null : text.trim() });
    setPlan(await getPlan(plan.id));
  }

  async function saveDayName(dayId: string, text: string) {
    await updateDay(dayId, { name: text.trim() });
    if (weekId) await loadWeekDays(weekId);
  }

  async function saveDayNote(dayId: string, text: string) {
    await updateDay(dayId, { note: text.trim() === '' ? null : text.trim() });
    if (weekId) await loadWeekDays(weekId);
  }

  const planMacros: Macros = meals.reduce(
    (acc, m) => addMacros(acc, sumMacros(itemsByMeal[m.id] ?? [])),
    EMPTY_MACROS,
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          {/* Header — editable title */}
          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <EditableText value={plan.title} onSave={savePlanTitle} textStyle={styles.title} placeholder="Plan name" />
            </View>
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

          <NoteEditor
            label="Plan note"
            value={plan.note}
            placeholder="Overall note for the trainee (e.g. focus on tempo this block)"
            onSave={savePlanNote}
          />

          {!isTraining && meals.length > 0 ? (
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>PLAN TOTAL</Text>
              <Text style={styles.totalMacros}>
                {planMacros.kcal} kcal · {planMacros.protein}P / {planMacros.carbs}C / {planMacros.fat}F
              </Text>
            </View>
          ) : null}

          {/* Week selector (training only) */}
          {isTraining ? (
            <View style={styles.weekBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weekPills}>
                {weeks.map((w) => (
                  <Pressable
                    key={w.id}
                    style={[styles.weekPill, w.id === weekId && styles.weekPillActive]}
                    onPress={() => selectWeek(w.id)}
                  >
                    <Text style={[styles.weekPillText, w.id === weekId && styles.weekPillTextActive]}>{w.name}</Text>
                  </Pressable>
                ))}
                <Pressable style={styles.weekAdd} onPress={onAddWeek} disabled={busy}>
                  <Text style={styles.weekAddText}>＋ Week</Text>
                </Pressable>
              </ScrollView>
              {weekId ? (
                <View style={styles.weekActions}>
                  <Pressable onPress={onDuplicateWeek} disabled={busy} hitSlop={6}>
                    <Text style={styles.weekActionText}>Duplicate this week</Text>
                  </Pressable>
                  {weeks.length > 1 ? (
                    <Pressable onPress={onDeleteWeek} disabled={busy} hitSlop={6}>
                      <Text style={[styles.weekActionText, styles.weekDelete]}>Delete week</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Body */}
          {isTraining
            ? days.map((d, i) => (
                <DayCard
                  key={d.id}
                  day={d}
                  exercises={exByDay[d.id] ?? []}
                  canMoveUp={i > 0}
                  canMoveDown={i < days.length - 1}
                  onMoveUp={() => moveDay(d, 'up')}
                  onMoveDown={() => moveDay(d, 'down')}
                  onAddExercise={() => router.push({ pathname: '/coach/exercise-picker', params: { dayId: d.id } })}
                  onOpenExercise={(rowId) => router.push({ pathname: '/coach/exercise/[id]', params: { id: rowId } })}
                  onDelete={() => onDeleteDay(d.id, d.name)}
                  onSaveName={(text) => saveDayName(d.id, text)}
                  onSaveNote={(text) => saveDayNote(d.id, text)}
                />
              ))
            : meals.map((m) => (
                <MealCard
                  key={m.id}
                  meal={m}
                  items={itemsByMeal[m.id] ?? []}
                  onAddFood={() => router.push({ pathname: '/coach/food-picker', params: { mealId: m.id } })}
                  onOpenItem={(itemId) => router.push({ pathname: '/coach/meal-item/[id]', params: { id: itemId } })}
                  onDelete={() => onDeleteMeal(m.id, m.name)}
                />
              ))}

          {/* Add day / meal */}
          {!isTraining || weekId ? (
            <View style={styles.addBox}>
              <TextInput
                style={styles.input}
                value={newName}
                onChangeText={setNewName}
                placeholder={isTraining ? 'New day (e.g. Arms)' : 'New meal (e.g. Breakfast)'}
                editable={!busy}
              />
              <Pressable style={styles.addBtn} onPress={onAddContainer} disabled={busy}>
                <Text style={styles.addBtnText}>Add {isTraining ? 'day' : 'meal'}</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Inline single-line editable text (required). Tap to edit; blank reverts. */
function EditableText({
  value,
  onSave,
  textStyle,
  placeholder,
}: {
  value: string;
  onSave: (text: string) => Promise<void>;
  textStyle: object;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);

  async function save() {
    const t = text.trim();
    if (t.length === 0) {
      setText(value);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(t);
      setEditing(false);
    } catch {
      Alert.alert('Error', 'Could not save.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <Pressable
        style={styles.editableRow}
        onPress={() => {
          setText(value);
          setEditing(true);
        }}
      >
        <Text style={textStyle}>{value}</Text>
        <Text style={styles.pencil}>✎</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.editableEdit}>
      <TextInput
        style={styles.editableInput}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        autoFocus
        editable={!saving}
        onSubmitEditing={save}
        returnKeyType="done"
      />
      <Pressable onPress={save} disabled={saving} hitSlop={8}>
        <Text style={styles.noteSave}>{saving ? '…' : 'Save'}</Text>
      </Pressable>
    </View>
  );
}

/** Inline editable coach comment (optional, multiline). */
function NoteEditor({
  label,
  value,
  placeholder,
  onSave,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  onSave: (text: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(text);
      setEditing(false);
    } catch {
      Alert.alert('Error', 'Could not save the note.');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <Pressable
        style={styles.noteRow}
        onPress={() => {
          setText(value ?? '');
          setEditing(true);
        }}
      >
        <Text style={styles.noteIcon}>💬</Text>
        {value ? <Text style={styles.noteText}>{value}</Text> : <Text style={styles.notePrompt}>{`Add ${label.toLowerCase()}`}</Text>}
      </Pressable>
    );
  }
  return (
    <View style={styles.noteEdit}>
      <TextInput
        style={styles.noteInput}
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        multiline
        editable={!saving}
        autoFocus
      />
      <View style={styles.noteBtns}>
        <Pressable onPress={() => setEditing(false)} disabled={saving} hitSlop={6}>
          <Text style={styles.noteCancel}>Cancel</Text>
        </Pressable>
        <Pressable onPress={save} disabled={saving} hitSlop={6}>
          <Text style={styles.noteSave}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DayCard({
  day,
  exercises,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onAddExercise,
  onOpenExercise,
  onDelete,
  onSaveName,
  onSaveNote,
}: {
  day: Day;
  exercises: ExerciseRow[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddExercise: () => void;
  onOpenExercise: (rowId: string) => void;
  onDelete: () => void;
  onSaveName: (text: string) => Promise<void>;
  onSaveNote: (text: string) => Promise<void>;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.flex}>
          <EditableText value={day.name} onSave={onSaveName} textStyle={styles.cardTitle} placeholder="Day name" />
        </View>
        <Pressable hitSlop={8} onPress={onMoveUp} disabled={!canMoveUp}>
          <Text style={[styles.move, !canMoveUp && styles.moveOff]}>▲</Text>
        </Pressable>
        <Pressable hitSlop={8} onPress={onMoveDown} disabled={!canMoveDown}>
          <Text style={[styles.move, !canMoveDown && styles.moveOff]}>▼</Text>
        </Pressable>
        <Pressable hitSlop={8} onPress={onDelete}>
          <Text style={styles.remove}>✕</Text>
        </Pressable>
      </View>
      <NoteEditor label="Day note" value={day.note} placeholder="Note for this day (e.g. rest 3 min on heavy sets)" onSave={onSaveNote} />
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
                {e.note ? <Text style={styles.exNote}>“{e.note}”</Text> : null}
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
  title: { fontSize: 24, fontWeight: '800', color: '#111' },
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
  weekBar: { marginTop: 6, gap: 8 },
  weekPills: { gap: 8, paddingVertical: 2 },
  weekPill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#eef0f3' },
  weekPillActive: { backgroundColor: '#1f6feb' },
  weekPillText: { fontSize: 13, fontWeight: '700', color: '#6e7781' },
  weekPillTextActive: { color: '#fff' },
  weekAdd: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#e7f0ff' },
  weekAddText: { fontSize: 13, fontWeight: '700', color: '#1f6feb' },
  weekActions: { flexDirection: 'row', gap: 16 },
  weekActionText: { fontSize: 13, fontWeight: '600', color: '#1f6feb' },
  weekDelete: { color: '#cf222e' },
  card: { backgroundColor: '#f5f6f8', borderRadius: 14, padding: 14, gap: 4, marginTop: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  move: { fontSize: 15, color: '#1f6feb', fontWeight: '700' },
  moveOff: { color: '#c2c8d0' },
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
  exRow: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  exName: { fontSize: 15, fontWeight: '600', color: '#111' },
  exMeta: { fontSize: 13, color: '#6e7781', marginTop: 1 },
  exNote: { fontSize: 13, color: '#1f6feb', fontStyle: 'italic', marginTop: 3 },
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
  // Editable single-line text
  editableRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pencil: { fontSize: 14, color: '#8a93a0' },
  editableEdit: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editableInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#1f6feb',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
    color: '#111',
    backgroundColor: '#fff',
  },
  // Note editor
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 6 },
  noteIcon: { fontSize: 14 },
  noteText: { flex: 1, fontSize: 14, color: '#1f6feb', fontStyle: 'italic' },
  notePrompt: { flex: 1, fontSize: 14, color: '#8a93a0' },
  noteEdit: { gap: 8, paddingVertical: 6 },
  noteInput: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#fff',
    minHeight: 60,
  },
  noteBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18 },
  noteCancel: { fontSize: 14, fontWeight: '600', color: '#6e7781' },
  noteSave: { fontSize: 14, fontWeight: '700', color: '#1f6feb' },
});
