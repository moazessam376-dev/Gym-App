// Coach → plan editor. TEMPLATE (no client → "Assign to client") or ASSIGNED plan
// (→ publish/unpublish). Training = Weeks → Days → block-grouped exercises with
// 3-level coach comments (plan / day / exercise) and editable titles + day order;
// nutrition = Meals → food items with macro totals. All writes are RLS-gated.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/lib/auth-context';
import { confirm, confirmDestructive } from '../../../src/lib/confirm';
import { haptics } from '../../../src/lib/haptics';
import {
  createDay,
  createMeal,
  createWeek,
  deleteDay,
  deleteMeal,
  deletePlan,
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
import { adjustPlan, getPlanInsight } from '../../../src/lib/coach-ai';
import { listClientNotes, type WorkoutNote } from '../../../src/lib/workout-notes';
import { Icon, useToast } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

export default function PlanEditor() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const toast = useToast();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();

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
  // "Adjust with AI" (Phase 13): draft-only rewrite from a coach instruction.
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustPrompt, setAdjustPrompt] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  // A freshly cloned/blank template is UNCOMMITTED until the coach taps "Save to my
  // plans" (or assigns it). `kept` records that commitment for this editor session.
  const [kept, setKept] = useState(false);
  // Athlete workout notes for THIS assigned plan's exercises, keyed by plan_exercise_id,
  // so the coach sees the client's feedback inline while amending the plan (0051).
  const [exNotes, setExNotes] = useState<Record<string, WorkoutNote[]>>({});

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
      // Assigned plan → pull the client's workout notes and group by exercise so they
      // render inline on each exercise row (the coach RLS already permits this read).
      if (p.client_id) {
        const cn = await listClientNotes(p.client_id, 100).catch(() => [] as WorkoutNote[]);
        const grouped: Record<string, WorkoutNote[]> = {};
        for (const n of cn) {
          if (!n.plan_exercise_id) continue;
          (grouped[n.plan_exercise_id] ??= []).push(n);
        }
        setExNotes(grouped);
      }
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

  // Don't silently keep a freshly-created template the coach never committed to. While
  // it's uncommitted, leaving prompts Discard / Keep-editing; Discard deletes the clone
  // so it never lands in "your plans". Tapping "Save to my plans" (or assigning) clears
  // this. Templates opened from the list carry no `fresh` flag, so they edit normally.
  const uncommitted = fresh === '1' && plan?.client_id === null && !kept;
  usePreventRemove(uncommitted, ({ data }) => {
    confirm(
      t('planEditor.keepTitle'),
      t('planEditor.keepBody'),
      t('planEditor.discardDraft'),
      t('common.keepEditing'),
    ).then(async (discard) => {
      if (!discard) return; // keep editing → stay
      try {
        if (plan) await deletePlan(plan.id);
      } catch {
        /* best-effort; leaving anyway */
      }
      navigation.dispatch(data.action);
    });
  });

  if (role && role !== 'coach') return <Redirect href="/" />;
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  if (!plan || !id) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>{t('planEditor.notFound')}</Text>
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
      Alert.alert(t('common.errorTitle'), t('planEditor.addWeekError'));
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
      Alert.alert(t('common.errorTitle'), t('planEditor.duplicateWeekError'));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteWeek() {
    if (!weekId) return;
    if (weeks.length <= 1) {
      Alert.alert(t('planEditor.keepOneWeekTitle'), t('planEditor.keepOneWeekBody'));
      return;
    }
    if (!(await confirmDestructive(t('planEditor.deleteWeekTitle'), t('planEditor.deleteWeekBody')))) return;
    setBusy(true);
    try {
      await deleteWeek(weekId);
      await refreshWeeks();
    } catch {
      Alert.alert(t('common.errorTitle'), t('planEditor.deleteWeekError'));
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
      Alert.alert(t('common.errorTitle'), t('planEditor.addError'));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteDay(dayId: string, name: string) {
    if (!(await confirmDestructive(t('planEditor.deleteDayTitle'), t('planEditor.deleteContainerBody', { name })))) return;
    try {
      await deleteDay(dayId);
      if (weekId) await loadWeekDays(weekId);
    } catch {
      Alert.alert(t('common.errorTitle'), t('planEditor.deleteError'));
    }
  }

  async function onDeleteMeal(mealId: string, name: string) {
    if (!(await confirmDestructive(t('planEditor.deleteMealTitle'), t('planEditor.deleteContainerBody', { name })))) return;
    try {
      await deleteMeal(mealId);
      await load();
    } catch {
      Alert.alert(t('common.errorTitle'), t('planEditor.deleteError'));
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
      Alert.alert(t('common.errorTitle'), t('planEditor.reorderError'));
    } finally {
      setBusy(false);
    }
  }

  // Commit a fresh template to "your plans" — it's already in the DB, so this just
  // clears the discard-on-leave guard and confirms it to the coach.
  function onKeepTemplate() {
    setKept(true);
    haptics.tap();
    toast.show(t('planEditor.savedToMyPlans'));
  }

  async function onTogglePublish() {
    if (!plan) return;
    setBusy(true);
    try {
      await setPlanStatus(plan.id, published ? 'draft' : 'published');
      await load();
    } catch {
      Alert.alert(t('common.errorTitle'), t('planEditor.statusError'));
    } finally {
      setBusy(false);
    }
  }

  // Throw away a draft (e.g. a bad AI generation) instead of leaving it orphaned.
  // Drafts are never visible to the client, so this is safe; published plans use
  // the unpublish path instead. RLS plans_delete allows the authoring coach.
  async function onDiscardDraft() {
    if (!plan) return;
    const ok = await confirmDestructive(
      t('planEditor.discardTitle'),
      t('planEditor.discardBody'),
      t('planEditor.discardDraft'),
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deletePlan(plan.id);
      router.back();
    } catch {
      setBusy(false);
      Alert.alert(t('common.errorTitle'), t('planEditor.deleteError'));
    }
  }

  async function openAdjust() {
    if (!plan) return;
    setAdjustPrompt('');
    setAdjustOpen(true);
    // If the plan is assigned, prefill with the client's latest AI suggestions so the
    // coach can apply the nudge in one tap (editable before sending).
    if (plan.client_id) {
      try {
        const insight = await getPlanInsight(plan.client_id);
        if (insight?.analysis) setAdjustPrompt(insight.analysis);
      } catch {
        /* no suggestions yet — fine */
      }
    }
  }

  async function onAdjust() {
    if (!plan || adjustBusy) return;
    setAdjustBusy(true);
    try {
      const res = await adjustPlan(plan.id, adjustPrompt.trim() || undefined);
      if (res.status === 'adjusted') {
        setAdjustOpen(false);
        setAdjustPrompt('');
        await load();
      } else if (res.status === 'not_draft') {
        Alert.alert(t('planEditor.publishFirstTitle'), t('planEditor.publishFirstBody'));
      } else if (res.status === 'rate_limited') {
        Alert.alert(t('planEditor.aiLimitTitle'), t('planEditor.aiLimitBody'));
      } else {
        Alert.alert(t('planEditor.adjustFailTitle'), t('planEditor.adjustFailBody'));
      }
    } finally {
      setAdjustBusy(false);
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
      <KeyboardAvoidingView style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.wrap}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          showsVerticalScrollIndicator>
          {/* Header — editable title */}
          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <EditableText value={plan.title} onSave={savePlanTitle} textStyle={styles.title} placeholder={t('planEditor.planNamePlaceholder')} />
            </View>
            <View style={[styles.status, isTemplate ? styles.template : PLAN_STATUS_STYLE[plan.status]]}>
              <Text style={styles.statusText}>{isTemplate ? t('planEditor.template') : t(`planStatus.${plan.status}`)}</Text>
            </View>
          </View>
          <Text style={styles.type}>{t(`common.${plan.type}`)}</Text>

          {/* Make the draft→published boundary explicit: an assigned draft is the
              coach's WIP and isn't visible to the client until Published. */}
          {!isTemplate && plan.status === 'draft' ? (
            <Text style={styles.draftHint}>{t('planEditor.draftHint')}</Text>
          ) : null}

          {/* Fresh, uncommitted template → an explicit "Save to my plans" (the user's
              requested fix). Until tapped, leaving the editor discards the clone. */}
          {uncommitted ? (
            <Pressable style={[styles.headerBtn, styles.save]} onPress={onKeepTemplate} disabled={busy}>
              <Text style={[styles.headerBtnText, styles.saveText]}>{t('planEditor.saveToMyPlans')}</Text>
            </Pressable>
          ) : null}

          {isTemplate ? (
            <Pressable
              style={[styles.headerBtn, styles.assign]}
              onPress={() => {
                setKept(true); // assigning commits the template too
                router.push({ pathname: '/coach/assign/[id]', params: { id: plan.id } });
              }}
            >
              <Text style={styles.headerBtnText}>{t('planEditor.assignToClient')}</Text>
            </Pressable>
          ) : (
            <Pressable
              style={[styles.headerBtn, published ? styles.unpublish : styles.publish]}
              onPress={onTogglePublish}
              disabled={busy}
            >
              <Text style={[styles.headerBtnText, styles.publishText]}>
                {published ? t('planEditor.unpublish') : t('planEditor.publish')}
              </Text>
            </Pressable>
          )}

          {/* Adjust with AI — drafts only (published plans are locked). */}
          {plan.status === 'draft' ? (
            <Pressable style={[styles.headerBtn, styles.adjust]} onPress={openAdjust} disabled={busy}>
              <Text style={styles.headerBtnText}>{t('planEditor.adjustWithAi')}</Text>
            </Pressable>
          ) : null}

          {/* Discard — only for an assigned draft (never a template, never published).
              Explicit alternative to silently leaving an orphaned draft behind. */}
          {!isTemplate && plan.status === 'draft' ? (
            <Pressable style={[styles.headerBtn, styles.discard]} onPress={onDiscardDraft} disabled={busy}>
              <Text style={styles.discardText}>{t('planEditor.discardDraft')}</Text>
            </Pressable>
          ) : null}

          <NoteEditor
            addPrompt={t('planEditor.addPlanNote')}
            value={plan.note}
            placeholder={t('planEditor.planNotePlaceholder')}
            onSave={savePlanNote}
          />

          {!isTraining && meals.length > 0 ? (
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>{t('planEditor.planTotal')}</Text>
              <Text style={styles.totalMacros}>
                {t('planView.macroLine', {
                  kcal: planMacros.kcal,
                  p: planMacros.protein,
                  c: planMacros.carbs,
                  f: planMacros.fat,
                })}
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
                  <Text style={styles.weekAddText}>{t('planEditor.addWeek')}</Text>
                </Pressable>
              </ScrollView>
              {weekId ? (
                <View style={styles.weekActions}>
                  <Pressable onPress={onDuplicateWeek} disabled={busy} hitSlop={6}>
                    <Text style={styles.weekActionText}>{t('planEditor.duplicateWeek')}</Text>
                  </Pressable>
                  {weeks.length > 1 ? (
                    <Pressable onPress={onDeleteWeek} disabled={busy} hitSlop={6}>
                      <Text style={[styles.weekActionText, styles.weekDelete]}>{t('planEditor.deleteWeek')}</Text>
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
                  notesByExercise={exNotes}
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
                  onAddFood={() =>
                    router.push({
                      pathname: '/coach/food-picker',
                      params: { mealId: m.id, clientId: plan.client_id ?? '' },
                    })
                  }
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
                placeholder={isTraining ? t('planEditor.newDayPlaceholder') : t('planEditor.newMealPlaceholder')}
                placeholderTextColor={theme.colors.textMuted}
                editable={!busy}
              />
              <Pressable style={styles.addBtn} onPress={onAddContainer} disabled={busy}>
                <Text style={styles.addBtnText}>{isTraining ? t('planEditor.addDay') : t('planEditor.addMeal')}</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Adjust-with-AI sheet: a coach instruction (prefilled from the client's latest
          AI suggestions when assigned) rewrites the DRAFT plan's contents in place. */}
      <Modal visible={adjustOpen} transparent animationType="slide" onRequestClose={() => setAdjustOpen(false)}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.sheetOverlay} onPress={() => !adjustBusy && setAdjustOpen(false)}>
            <Pressable style={styles.sheet} onPress={Keyboard.dismiss}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.sheetTitle}>{t('planEditor.adjustWithAi')}</Text>
                <Pressable onPress={() => !adjustBusy && setAdjustOpen(false)} hitSlop={8}>
                  <Icon name="x" size={22} color={theme.colors.textMuted} />
                </Pressable>
              </View>
              <Text style={styles.sheetHint}>
                {t('planEditor.adjustHint')}
              </Text>
              <TextInput
                style={styles.adjustInput}
                value={adjustPrompt}
                onChangeText={setAdjustPrompt}
                placeholder={t('planEditor.adjustPlaceholder')}
                placeholderTextColor={theme.colors.textMuted}
                editable={!adjustBusy}
                multiline
              />
              <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Pressable onPress={() => !adjustBusy && setAdjustOpen(false)} style={{ paddingVertical: 13, paddingHorizontal: 16 }}>
                  <Text style={{ color: theme.colors.link, fontSize: 15, fontFamily: theme.fontFamily.bodySemiBold }}>{t('common.cancel')}</Text>
                </Pressable>
                <Pressable style={[styles.adjustSend, adjustBusy && { opacity: 0.6 }]} onPress={onAdjust} disabled={adjustBusy}>
                  {adjustBusy ? (
                    <ActivityIndicator color={theme.colors.onPrimary} />
                  ) : (
                    <Text style={styles.adjustSendText}>{t('planEditor.adjustPlan')}</Text>
                  )}
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
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
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setText(value);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      Alert.alert(t('common.errorTitle'), t('planEditor.saveError'));
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
        <Icon name="pencil" size={14} color={theme.colors.textMuted} />
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
        placeholderTextColor={theme.colors.textMuted}
        autoFocus
        editable={!saving}
        onSubmitEditing={save}
        returnKeyType="done"
      />
      <Pressable onPress={save} disabled={saving} hitSlop={8}>
        <Text style={styles.noteSave}>{saving ? '…' : t('common.save')}</Text>
      </Pressable>
    </View>
  );
}

/** Inline editable coach comment (optional, multiline). */
function NoteEditor({
  addPrompt,
  value,
  placeholder,
  onSave,
}: {
  addPrompt: string;
  value: string | null;
  placeholder: string;
  onSave: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(text);
      setEditing(false);
    } catch {
      Alert.alert(t('common.errorTitle'), t('planEditor.saveNoteError'));
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
        <Icon name="message-square" size={14} color={theme.colors.textMuted} />
        {value ? <Text style={styles.noteText}>{value}</Text> : <Text style={styles.notePrompt}>{addPrompt}</Text>}
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
        placeholderTextColor={theme.colors.textMuted}
        multiline
        editable={!saving}
        autoFocus
      />
      <View style={styles.noteBtns}>
        <Pressable onPress={() => setEditing(false)} disabled={saving} hitSlop={6}>
          <Text style={styles.noteCancel}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable onPress={save} disabled={saving} hitSlop={6}>
          <Text style={styles.noteSave}>{saving ? t('planEditor.saving') : t('common.save')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function DayCard({
  day,
  exercises,
  notesByExercise,
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
  notesByExercise: Record<string, WorkoutNote[]>;
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
  const { t } = useTranslation();
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.flex}>
          <EditableText value={day.name} onSave={onSaveName} textStyle={styles.cardTitle} placeholder={t('planEditor.dayNamePlaceholder')} />
        </View>
        <Pressable hitSlop={8} onPress={onMoveUp} disabled={!canMoveUp}>
          <Icon name="chevron-up" size={18} color={canMoveUp ? theme.colors.primary : theme.colors.borderStrong} />
        </Pressable>
        <Pressable hitSlop={8} onPress={onMoveDown} disabled={!canMoveDown}>
          <Icon name="chevron-down" size={18} color={canMoveDown ? theme.colors.primary : theme.colors.borderStrong} />
        </Pressable>
        <Pressable hitSlop={8} onPress={onDelete}>
          <Icon name="x" size={18} color={theme.colors.danger} />
        </Pressable>
      </View>
      <NoteEditor addPrompt={t('planEditor.addDayNote')} value={day.note} placeholder={t('planEditor.dayNotePlaceholder')} onSave={onSaveNote} />
      {BLOCK_ORDER.filter((b) => exercises.some((e) => e.block === b)).map((b) => (
        <View key={b}>
          <Text style={styles.blockLabel}>{BLOCK_LABEL[b]}</Text>
          {exercises
            .filter((e) => e.block === b)
            .map((e) => (
              <Pressable key={e.id} style={styles.exRow} onPress={() => onOpenExercise(e.id)}>
                <Text style={styles.exName}>{e.exercise_name}</Text>
                <Text style={styles.exMeta}>
                  {[
                    e.sets != null ? `${e.sets}×${e.reps ?? '—'}` : null,
                    e.rest_seconds != null ? t('planView.restShort', { n: e.rest_seconds }) : null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ') || t('planEditor.tapToSetDetails')}
                </Text>
                {e.note ? <Text style={styles.exNote}>“{e.note}”</Text> : null}
                {(notesByExercise[e.id] ?? []).map((n) => {
                  const tint = n.category === 'compliment' ? theme.colors.success : theme.colors.warning;
                  return (
                    <View key={n.id} style={styles.clientNoteRow}>
                      <Icon name="clipboard" size={12} color={tint} />
                      <Text style={[styles.clientNoteText, { color: tint }]}>{n.body}</Text>
                    </View>
                  );
                })}
              </Pressable>
            ))}
        </View>
      ))}
      <Pressable style={styles.addInline} onPress={onAddExercise}>
        <Text style={styles.addInlineText}>{t('planEditor.addExercise')}</Text>
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
  const { t } = useTranslation();
  const macros = sumMacros(items);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{meal.name}</Text>
        <Pressable hitSlop={10} onPress={onDelete}>
          <Icon name="x" size={17} color={theme.colors.danger} />
        </Pressable>
      </View>
      {items.length > 0 ? (
        <Text style={styles.mealMacros}>
          {t('planView.macroLine', { kcal: macros.kcal, p: macros.protein, c: macros.carbs, f: macros.fat })}
        </Text>
      ) : null}
      {items.map((it) => (
        <Pressable key={it.id} style={styles.exRow} onPress={() => onOpenItem(it.id)}>
          <Text style={styles.exName}>{it.food_name}</Text>
          <Text style={styles.exMeta}>{t('planEditor.gramsShort', { grams: it.grams })}</Text>
        </Pressable>
      ))}
      <Pressable style={styles.addInline} onPress={onAddFood}>
        <Text style={styles.addInlineText}>{t('planEditor.addFood')}</Text>
      </Pressable>
    </View>
  );
}

const c = theme.colors;
const f = theme.fontFamily;
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg },
  wrap: { padding: 16, paddingBottom: 160, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 24, fontFamily: f.displayBold, color: c.text },
  type: { fontSize: 14, fontFamily: f.bodyRegular, color: c.textMuted, textTransform: 'capitalize' },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  template: { backgroundColor: c.secondary },
  statusText: { color: c.onPrimary, fontSize: 12, fontFamily: f.bodyBold, textTransform: 'capitalize' },
  headerBtn: { borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginTop: 6 },
  assign: { backgroundColor: c.secondary },
  save: { backgroundColor: c.primary }, // brand Signal cyan — the primary commit action
  saveText: { color: c.onPrimary }, // dark text ON cyan (onPrimary is onyx, not white)
  publish: { backgroundColor: c.primary }, // brand Signal cyan — the primary CTA, NOT success-green
  publishText: { color: c.onPrimary }, // dark onyx text on cyan/amber (matches saveText; never white)
  unpublish: { backgroundColor: c.warning },
  adjust: { backgroundColor: c.glass, borderWidth: 1, borderColor: c.glassBorder },
  discard: { backgroundColor: c.glass, borderWidth: 1, borderColor: c.danger },
  headerBtnText: { color: c.white, fontSize: 15, fontFamily: f.bodySemiBold },
  draftHint: { color: c.textMuted, fontSize: 13, fontFamily: f.bodyRegular, marginTop: 2 },
  discardText: { color: c.danger, fontSize: 15, fontFamily: f.bodySemiBold },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
  sheet: { backgroundColor: c.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, paddingBottom: 28, gap: 12 },
  sheetTitle: { color: c.text, fontSize: 18, fontFamily: f.displaySemiBold, flex: 1 },
  sheetHint: { color: c.textMuted, fontSize: 13, fontFamily: f.bodyRegular },
  adjustInput: {
    backgroundColor: c.bg,
    borderWidth: 1,
    borderColor: c.glassBorder,
    borderRadius: 10,
    padding: 12,
    color: c.text,
    fontSize: 15,
    fontFamily: f.bodyRegular,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  adjustSend: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 13, alignItems: 'center', flex: 1 },
  adjustSendText: { color: c.onPrimary, fontSize: 15, fontFamily: f.bodyBold },
  totalCard: { backgroundColor: c.glass, borderWidth: 1, borderColor: c.glassBorder, borderRadius: 12, padding: 12, marginTop: 4 },
  totalLabel: { fontSize: 11, fontFamily: f.bodyBold, letterSpacing: 1, color: c.primary },
  totalMacros: { fontSize: 15, fontFamily: f.monoBold, color: c.text, marginTop: 2 },
  weekBar: { marginTop: 6, gap: 8 },
  weekPills: { gap: 8, paddingVertical: 2 },
  weekPill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.glass, borderWidth: 1, borderColor: c.glassBorder },
  weekPillActive: { backgroundColor: c.primary, borderColor: c.primary },
  weekPillText: { fontSize: 13, fontFamily: f.bodyBold, color: c.textMuted },
  weekPillTextActive: { color: c.onPrimary },
  weekAdd: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.glassStrong, borderWidth: 1, borderColor: c.glassBorder },
  weekAddText: { fontSize: 13, fontFamily: f.bodyBold, color: c.primary },
  weekActions: { flexDirection: 'row', gap: 16 },
  weekActionText: { fontSize: 13, fontFamily: f.bodySemiBold, color: c.primary },
  weekDelete: { color: c.danger },
  card: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14, gap: 4, marginTop: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 17, fontFamily: f.displaySemiBold, color: c.text },
  blockLabel: {
    fontSize: 11,
    fontFamily: f.bodyBold,
    letterSpacing: 0.5,
    color: c.textMuted,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  mealMacros: { fontSize: 13, color: c.primary, fontFamily: f.monoMedium, marginBottom: 2 },
  exRow: { backgroundColor: c.glass, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  exName: { fontSize: 15, fontFamily: f.bodySemiBold, color: c.text },
  exMeta: { fontSize: 13, fontFamily: f.bodyRegular, color: c.textMuted, marginTop: 1 },
  exNote: { fontSize: 13, fontFamily: f.bodyRegular, color: c.primary, fontStyle: 'italic', marginTop: 3 },
  // The client's logged workout note shown inline on the exercise (0051).
  clientNoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 4 },
  clientNoteText: { flex: 1, fontSize: 13, fontFamily: f.bodyRegular },
  addInline: { paddingVertical: 10, marginTop: 4 },
  addInlineText: { color: c.primary, fontFamily: f.bodySemiBold, fontSize: 15 },
  addBox: { gap: 8, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: f.bodyRegular,
    color: c.text,
    backgroundColor: c.surface,
  },
  addBtn: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  addBtnText: { color: c.onPrimary, fontSize: 16, fontFamily: f.bodySemiBold },
  empty: { fontSize: 15, fontFamily: f.bodyRegular, color: c.textMuted },
  // Editable single-line text
  editableRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editableEdit: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editableInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: c.primary,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
    fontFamily: f.bodyRegular,
    color: c.text,
    backgroundColor: c.surface,
  },
  // Note editor
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 6 },
  noteText: { flex: 1, fontSize: 14, fontFamily: f.bodyRegular, color: c.primary, fontStyle: 'italic' },
  notePrompt: { flex: 1, fontSize: 14, fontFamily: f.bodyRegular, color: c.textMuted },
  noteEdit: { gap: 8, paddingVertical: 6 },
  noteInput: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: f.bodyRegular,
    color: c.text,
    backgroundColor: c.surface,
    minHeight: 60,
    maxHeight: 140, // cap growth so newlines can't break the layout
    textAlignVertical: 'top',
  },
  noteBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18 },
  noteCancel: { fontSize: 14, fontFamily: f.bodySemiBold, color: c.textMuted },
  noteSave: { fontSize: 14, fontFamily: f.bodyBold, color: c.primary },
});
