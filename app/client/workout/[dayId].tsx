// Workout logging — the satisfying part. For each set the client logs reps + the
// weight they used (kg OR lb, chosen PER EXERCISE since machines differ; stored as
// integer grams). The ring fills as sets complete. Beating your best e1RM (which
// rewards more reps at the same load) or your best reps pops a "PR" badge. You can
// also fire a quick note to your coach (Challenge / Compliment, migration 0021).
// A set needs reps; WEIGHT IS OPTIONAL so bodyweight moves (pull-ups, plank) log
// cleanly (empty weight => load_grams null). A rest timer counts down after each set.
// Finishing completes the workout_sessions row that powers streaks/adherence — and if
// nothing was logged we confirm first, so we don't pollute streak/adherence data.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/lib/auth-context';
import { listExerciseRows, type ExerciseRow } from '../../../src/lib/plans';
import { BLOCK_LABEL } from '../../../src/lib/plan-ui';
import {
  completeSession,
  createSession,
  deleteSetLog,
  estimatedOneRepMaxGrams,
  getExercisePRs,
  getExerciseUnits,
  getSessionForDay,
  listSetLogs,
  logSet,
  setExerciseUnit,
  todayLocalDate,
  updateSetLog,
  type ExercisePR,
  type WorkoutSession,
} from '../../../src/lib/sessions';
import { getMyAthleteProfile } from '../../../src/lib/athlete-profile';
import {
  createWorkoutNote,
  deleteWorkoutNoteForEveryone,
  hideWorkoutNote,
  listSessionNotes,
  type NoteCategory,
  type WorkoutNote,
} from '../../../src/lib/workout-notes';
import { convertDisplay, displayToGrams, formatWeight, gramsToInput, type WeightUnit } from '../../../src/lib/units';
import { confirm } from '../../../src/lib/confirm';
import { haptics } from '../../../src/lib/haptics';
import { Icon, Screen, Text, Card, Badge, Button, Chip, Input, ProgressRing } from '../../../src/components/ui';
import { NoteDeleteSheet } from '../../../src/components/NoteDeleteSheet';
import { theme } from '../../../src/theme';

const key = (exerciseId: string, setIndex: number) => `${exerciseId}:${setIndex}`;

function intOrNull(s?: string): number | null {
  if (!s || s.trim() === '') return null;
  const n = parseInt(s.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Seconds → m:ss for the rest timer. */
function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Which exercise (or the whole session) the note composer is targeting.
type Composer = { scope: 'session' } | { scope: 'exercise'; exId: string; exName: string };

export default function WorkoutScreen() {
  const { dayId, planId, name } = useLocalSearchParams<{
    dayId: string;
    planId?: string;
    name?: string;
  }>();
  const { t, i18n } = useTranslation();
  const { role, session: auth } = useAuth();
  const router = useRouter();
  const userId = auth?.user?.id;

  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  // Default display unit (athlete_profile.weight_unit) + per-exercise overrides.
  const [defaultUnit, setDefaultUnit] = useState<WeightUnit>('kg');
  const [units, setUnits] = useState<Map<string, WeightUnit>>(new Map());
  // key -> set log id (presence = completed)
  const [done, setDone] = useState<Map<string, string>>(new Map());
  // key -> entered reps / weight (weight is in the exercise's display unit)
  const [reps, setReps] = useState<Map<string, string>>(new Map());
  const [weight, setWeight] = useState<Map<string, string>>(new Map());
  // keys that tried to complete without reps+weight (show red, block completion)
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  // exercise_name -> all-time bests (from history), for PR detection
  const [prInfo, setPrInfo] = useState<Map<string, ExercisePR>>(new Map());
  const [notes, setNotes] = useState<WorkoutNote[]>([]);
  // The note whose remove-options sheet is open (Hide from my log / Delete for everyone).
  const [noteMenuFor, setNoteMenuFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  // Measured height of the sticky finish bar (E8) — drives the list's bottom inset so it
  // clears the bar exactly, instead of a hardcoded 160 that left a gap on short screens.
  const [finishBarH, setFinishBarH] = useState(96);

  // Rest timer — counts down ex.rest_seconds after a set is completed. restEndsAt is
  // the wall-clock target (survives re-renders); a 250ms tick keeps the seconds snappy.
  const [restEndsAt, setRestEndsAt] = useState<number | null>(null);
  const [restRemaining, setRestRemaining] = useState(0);

  // Note composer
  const [composer, setComposer] = useState<Composer | null>(null);
  const [noteCat, setNoteCat] = useState<NoteCategory>('challenge');
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const unitFor = useCallback(
    (exerciseName: string): WeightUnit => units.get(exerciseName) ?? defaultUnit,
    [units, defaultUnit],
  );

  const load = useCallback(async () => {
    if (!userId || !dayId) return;
    try {
      // allSettled: a failing read (PR view / unit prefs) must NOT blank the
      // exercises — the workout still has to load and be loggable.
      const [rowsR, profileR, prsR, unitsR] = await Promise.allSettled([
        listExerciseRows(dayId),
        getMyAthleteProfile(userId),
        getExercisePRs(userId),
        getExerciseUnits(userId),
      ]);
      const profile = profileR.status === 'fulfilled' ? profileR.value : null;
      const defU: WeightUnit = profile?.weight_unit ?? 'kg';
      const unitMap = unitsR.status === 'fulfilled' ? unitsR.value : new Map<string, WeightUnit>();
      setDefaultUnit(defU);
      setUnits(unitMap);
      const rows = rowsR.status === 'fulfilled' ? rowsR.value : [];
      setExercises(rows);
      if (prsR.status === 'fulfilled') setPrInfo(prsR.value);

      const existing = await getSessionForDay(userId, dayId, todayLocalDate());
      setSession(existing);
      if (existing) {
        const [logs, sessNotes] = await Promise.all([
          listSetLogs(existing.id),
          listSessionNotes(existing.id),
        ]);
        const dm = new Map<string, string>();
        const rm = new Map<string, string>();
        const wm = new Map<string, string>();
        for (const l of logs) {
          if (!l.plan_exercise_id) continue;
          const k = key(l.plan_exercise_id, l.set_index);
          if (l.is_completed) dm.set(k, l.id);
          if (l.reps_done != null) rm.set(k, String(l.reps_done));
          if (l.load_grams != null) wm.set(k, gramsToInput(l.load_grams, unitMap.get(l.exercise_name) ?? defU));
        }
        setDone(dm);
        setReps(rm);
        setWeight(wm);
        setNotes(sessNotes);
      }
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [userId, dayId]);

  useEffect(() => {
    load();
  }, [load]);

  // Start / skip the post-set rest countdown.
  const startRest = useCallback((seconds: number) => {
    setRestRemaining(seconds);
    setRestEndsAt(Date.now() + seconds * 1000);
  }, []);
  const skipRest = useCallback(() => {
    setRestEndsAt(null);
    setRestRemaining(0);
  }, []);
  useEffect(() => {
    if (restEndsAt == null) return;
    const tick = () => {
      const msLeft = restEndsAt - Date.now();
      setRestRemaining(Math.max(0, Math.round(msLeft / 1000)));
      if (msLeft <= 0) {
        setRestEndsAt(null);
        haptics.success(); // rest's up
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [restEndsAt]);

  const totalPlanned = useMemo(
    () => exercises.reduce((sum, e) => sum + (e.sets ?? 0), 0),
    [exercises],
  );
  const doneCount = done.size;
  const progress = totalPlanned > 0 ? doneCount / totalPlanned : 0;
  const fullyDone = totalPlanned > 0 && doneCount >= totalPlanned;

  const refreshPRs = useCallback(async () => {
    if (!userId) return;
    try {
      setPrInfo(await getExercisePRs(userId));
    } catch {
      /* keep prior */
    }
  }, [userId]);

  // PRs derived from local state + all-time bests. Because the all-time best
  // (prInfo) already includes saved sets, the badge persists across reloads; and
  // because it reads the live reps/weight maps, it updates in real time. e1RM
  // rewards MORE REPS at the same load, and unloaded sets fall back to a rep PR.
  const prKeys = useMemo(() => {
    const flagged = new Set<string>();
    for (const ex of exercises) {
      const u = units.get(ex.exercise_name) ?? defaultUnit;
      const hist = prInfo.get(ex.exercise_name);
      const histE1rm = hist?.bestE1rmGrams ?? 0;
      const histReps = hist?.bestReps ?? 0;
      let topWeightedKey: string | null = null;
      let topWeightedE1rm = 0;
      let topRepsKey: string | null = null;
      let topReps = 0;
      for (let i = 0; i < (ex.sets ?? 0); i++) {
        const k = key(ex.id, i);
        if (!done.has(k)) continue;
        const grams = displayToGrams(weight.get(k) ?? '', u) ?? 0;
        const r = intOrNull(reps.get(k)) ?? 0;
        if (grams > 0) {
          const e = estimatedOneRepMaxGrams(grams, r);
          if (e > topWeightedE1rm) {
            topWeightedE1rm = e;
            topWeightedKey = k;
          }
        } else if (r > topReps) {
          topReps = r;
          topRepsKey = k;
        }
      }
      if (topWeightedKey && topWeightedE1rm >= histE1rm) flagged.add(topWeightedKey);
      if (topRepsKey && topReps >= histReps && histReps > 0) flagged.add(topRepsKey);
    }
    return flagged;
  }, [exercises, prInfo, done, weight, reps, units, defaultUnit]);

  // Live best weight per exercise (history ∪ this session) for the "best 60 kg" line.
  const bestLoadByEx = useMemo(() => {
    const m = new Map<string, number>();
    for (const ex of exercises) {
      const u = units.get(ex.exercise_name) ?? defaultUnit;
      let best = prInfo.get(ex.exercise_name)?.bestLoadGrams ?? 0;
      for (let i = 0; i < (ex.sets ?? 0); i++) {
        const k = key(ex.id, i);
        if (!done.has(k)) continue;
        const grams = displayToGrams(weight.get(k) ?? '', u) ?? 0;
        if (grams > best) best = grams;
      }
      if (best > 0) m.set(ex.exercise_name, best);
    }
    return m;
  }, [exercises, prInfo, done, weight, units, defaultUnit]);

  // Create the session lazily on the first write (no empty sessions).
  async function ensureSession(): Promise<WorkoutSession> {
    if (session) return session;
    const created = await createSession(userId!, {
      plan_id: planId ?? null,
      day_id: dayId,
      session_date: todayLocalDate(),
      status: 'in_progress',
    });
    setSession(created);
    return created;
  }

  // Set a reps/weight field and clear any "missing value" flag for that set.
  function editField(
    setter: React.Dispatch<React.SetStateAction<Map<string, string>>>,
    k: string,
    v: string,
  ) {
    setter((prev) => new Map(prev).set(k, v));
    setInvalid((prev) => {
      if (!prev.has(k)) return prev;
      const n = new Set(prev);
      n.delete(k);
      return n;
    });
  }

  // Flip the display unit for one exercise (per-machine), converting its entered
  // weights and persisting the choice by exercise name.
  function toggleExerciseUnit(ex: ExerciseRow, next: WeightUnit) {
    const cur = unitFor(ex.exercise_name);
    if (cur === next) return;
    setWeight((prev) => {
      const n = new Map(prev);
      for (let i = 0; i < (ex.sets ?? 0); i++) {
        const k = key(ex.id, i);
        const v = n.get(k);
        if (v != null && v !== '') n.set(k, convertDisplay(v, cur, next));
      }
      return n;
    });
    setUnits((prev) => new Map(prev).set(ex.exercise_name, next));
    if (userId) setExerciseUnit(userId, ex.exercise_name, next).catch(() => {});
  }

  async function toggleSet(ex: ExerciseRow, setIndex: number) {
    if (busy) return;
    const k = key(ex.id, setIndex);
    const existingId = done.get(k);

    // Completing a set REQUIRES reps > 0. WEIGHT IS OPTIONAL — an empty weight is a
    // valid bodyweight set (pull-ups, plank…); a *typed* weight still has to be > 0.
    if (!existingId) {
      const repsVal = intOrNull(reps.get(k));
      const wStr = (weight.get(k) ?? '').trim();
      const grams = wStr === '' ? null : displayToGrams(wStr, unitFor(ex.exercise_name));
      if (repsVal == null || repsVal <= 0 || (wStr !== '' && (grams == null || grams <= 0))) {
        setInvalid((prev) => new Set(prev).add(k));
        return;
      }
    }

    setBusy(true);
    try {
      if (existingId) {
        await deleteSetLog(existingId);
        setDone((prev) => {
          const next = new Map(prev);
          next.delete(k);
          return next;
        });
      } else {
        const s = await ensureSession();
        // Empty weight => null grams (bodyweight), never 0 (displayToGrams('') is 0).
        const wStr = (weight.get(k) ?? '').trim();
        const grams = wStr === '' ? null : displayToGrams(wStr, unitFor(ex.exercise_name));
        const row = await logSet({
          session_id: s.id,
          plan_exercise_id: ex.id,
          exercise_name: ex.exercise_name,
          set_index: setIndex,
          reps_done: intOrNull(reps.get(k)),
          load_grams: grams,
          is_completed: true,
        });
        setDone((prev) => new Map(prev).set(k, row.id));
        haptics.tap();
        if (ex.rest_seconds) startRest(ex.rest_seconds);
      }
      refreshPRs(); // keep all-time bests current for cross-session PR detection
    } catch {
      /* swallow — UI stays consistent on next load */
    } finally {
      setBusy(false);
    }
  }

  // Persist reps/weight edits to an already-completed set (on blur). A completed set
  // must keep valid reps>0; weight stays OPTIONAL (bodyweight). Editing reps to
  // empty/0 — or a *typed* weight to 0/garbage — UN-COMPLETES it (deletes the log)
  // and flags it red, so you can't end up with a "done" set logged as 0 reps.
  async function persistIfDone(ex: ExerciseRow, setIndex: number) {
    const k = key(ex.id, setIndex);
    const id = done.get(k);
    if (!id) return;
    const repsVal = intOrNull(reps.get(k));
    const wStr = (weight.get(k) ?? '').trim();
    const grams = wStr === '' ? null : displayToGrams(wStr, unitFor(ex.exercise_name));
    if (repsVal == null || repsVal <= 0 || (wStr !== '' && (grams == null || grams <= 0))) {
      try {
        await deleteSetLog(id);
      } catch {
        /* ignore */
      }
      setDone((prev) => {
        const n = new Map(prev);
        n.delete(k);
        return n;
      });
      setInvalid((prev) => new Set(prev).add(k));
      refreshPRs();
      return;
    }
    try {
      await updateSetLog(id, { reps_done: repsVal, load_grams: grams });
      refreshPRs(); // edited weight/reps may set a new PR
    } catch {
      /* ignore */
    }
  }

  function openComposer(c: Composer) {
    setComposer(c);
    setNoteCat('challenge');
    setNoteBody('');
  }

  function closeComposer() {
    Keyboard.dismiss();
    setComposer(null);
    setNoteBody('');
  }

  // Short, locale-aware date for a note (e.g. "Jun 27") so the athlete can see when they
  // left it and decide whether to clear it.
  function noteDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(i18n.language, { month: 'short', day: 'numeric' });
  }

  // Tapping the trash icon opens a sheet with the two remove intents (0060): "Hide
  // from my log" keeps the coach's chat copy; "Delete for everyone" also retracts it.
  function removeNote(id: string) {
    setNoteMenuFor(id);
  }

  // Hide from my exercise view only — the note (and its chat copy to the coach) lives on.
  async function hideNoteFromLog(id: string) {
    const prev = notes;
    setNotes((cur) => cur.filter((x) => x.id !== id));
    try {
      await hideWorkoutNote(id);
      haptics.tap();
    } catch {
      setNotes(prev); // restore on failure
    }
  }

  // Delete everywhere — removes the note AND retracts the mirrored chat note card.
  async function deleteNoteEverywhere(id: string) {
    const prev = notes;
    setNotes((cur) => cur.filter((x) => x.id !== id));
    try {
      await deleteWorkoutNoteForEveryone(id);
      haptics.tap();
    } catch {
      setNotes(prev); // restore on failure
    }
  }

  async function saveNote() {
    if (!composer || !userId || noteBody.trim() === '') return;
    setSavingNote(true);
    try {
      const s = await ensureSession();
      await createWorkoutNote(userId, {
        session_id: s.id,
        plan_exercise_id: composer.scope === 'exercise' ? composer.exId : null,
        exercise_name: composer.scope === 'exercise' ? composer.exName : null,
        category: noteCat,
        body: noteBody.trim(),
      });
      setNotes(await listSessionNotes(s.id));
      setComposer(null);
      setNoteBody('');
    } catch {
      /* keep the composer open so they can retry */
    } finally {
      setSavingNote(false);
    }
  }

  async function finish() {
    // Don't pollute streak/adherence with an empty "done" session — confirm first.
    if (doneCount === 0) {
      const ok = await confirm(
        t('workout.confirmTitle'),
        t('workout.confirmBody'),
        t('workout.markDone'),
        t('workout.keepLogging'),
      );
      if (!ok) return;
    }
    setBusy(true);
    try {
      const s = await ensureSession();
      await completeSession(s.id);
      haptics.success();
      setCelebrating(true);
      setTimeout(() => router.back(), 1700);
    } catch {
      setBusy(false);
    }
  }

  if (role && role !== 'client') return <Redirect href="/" />;

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: name ?? t('workout.title') }} />
      <Screen padded={false}>
        {/* Sticky progress header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.spacing.lg,
            padding: theme.spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: theme.colors.border,
          }}
        >
          <ProgressRing progress={progress} size={64} strokeWidth={7}>
            <Text variant="bodyStrong">{Math.round(progress * 100)}%</Text>
          </ProgressRing>
          <View style={{ flex: 1 }}>
            <Text variant="title">{name ?? t('workout.title')}</Text>
            <Text variant="caption" muted>
              {t('workout.setsComplete', { done: doneCount, total: totalPlanned })}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: finishBarH + theme.spacing.md }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          {exercises.map((ex) => {
            const sets = ex.sets ?? 0;
            const u = unitFor(ex.exercise_name);
            const best = bestLoadByEx.get(ex.exercise_name);
            const hasInvalid = Array.from({ length: sets }).some((_, i) => invalid.has(key(ex.id, i)));
            // Notes this athlete has already left on THIS exercise (so the button shows
            // a "done" state and the note is visible — no accidental duplicate).
            const myNotes = notes.filter((n) => n.plan_exercise_id === ex.id);
            return (
              <Card key={ex.id}>
                <View style={{ gap: theme.spacing.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="title">{ex.exercise_name}</Text>
                      <Text variant="caption" muted>
                        {sets} × {ex.reps ?? '—'}
                        {ex.rest_seconds ? ` · ${t('workout.restShort', { sec: ex.rest_seconds })}` : ''}
                        {best ? ` · ${t('workout.bestShort', { weight: formatWeight(best, u) })}` : ''}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => openComposer({ scope: 'exercise', exId: ex.id, exName: ex.exercise_name })}
                      hitSlop={8}
                      style={{ paddingTop: 2 }}
                      accessibilityLabel={t('workout.noteToCoach')}
                    >
                      <Icon
                        name={myNotes.length > 0 ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
                        size={20}
                        color={myNotes.length > 0 ? theme.colors.primary : theme.colors.textMuted}
                      />
                    </Pressable>
                  </View>

                  {ex.note ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: theme.spacing.sm,
                        backgroundColor: theme.colors.surfaceElevated,
                        borderRadius: theme.radii.sm,
                        padding: theme.spacing.md,
                      }}
                    >
                      <Icon name="chatbubble-ellipses" size={16} color={theme.colors.primary} />
                      <Text variant="caption" style={{ flex: 1 }}>
                        {ex.note}
                      </Text>
                    </View>
                  ) : null}

                  {/* The athlete's OWN notes on this exercise — shown so they can see
                      what they already sent the coach and don't repeat it. */}
                  {myNotes.map((n) => {
                    const tint = n.category === 'compliment' ? theme.colors.success : theme.colors.warning;
                    return (
                      <View
                        key={n.id}
                        style={{
                          flexDirection: 'row',
                          gap: theme.spacing.sm,
                          backgroundColor: theme.colors.surfaceElevated,
                          borderRadius: theme.radii.sm,
                          borderLeftWidth: 3,
                          borderLeftColor: tint,
                          padding: theme.spacing.md,
                        }}
                      >
                        <Icon name="clipboard" size={16} color={tint} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                            <Text variant="label" style={{ color: tint, fontSize: 10, flex: 1 }}>
                              {t(`workout.${n.category}`)}
                            </Text>
                            <Text variant="label" muted style={{ fontSize: 10 }}>
                              {noteDate(n.created_at)}
                            </Text>
                          </View>
                          <Text variant="caption">{n.body}</Text>
                        </View>
                        <Pressable
                          onPress={() => removeNote(n.id)}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={t('workout.deleteNote')}
                        >
                          <Icon name="close" size={16} color={theme.colors.textMuted} />
                        </Pressable>
                      </View>
                    );
                  })}

                  {/* Meta row: block tag + per-exercise kg/lb toggle */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <Badge label={BLOCK_LABEL[ex.block]} tone="secondary" />
                    <View style={{ flex: 1 }} />
                    <Text variant="label" muted style={{ fontSize: 10 }}>
                      UNIT
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      <Chip label="kg" active={u === 'kg'} onPress={() => toggleExerciseUnit(ex, 'kg')} />
                      <Chip label="lb" active={u === 'lb'} onPress={() => toggleExerciseUnit(ex, 'lb')} />
                    </View>
                  </View>

                  {/* Set rows: tap the number to complete; reps + weight required */}
                  {sets === 0 ? (
                    <Text variant="caption" muted>
                      {t('workout.noSets')}
                    </Text>
                  ) : (
                    <View style={{ gap: theme.spacing.sm }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                        <View style={{ width: 44 }} />
                        <Text variant="label" muted style={{ width: 72, textAlign: 'center' }}>
                          {t('workout.reps')}
                        </Text>
                        <Text variant="label" muted style={{ width: 72, textAlign: 'center' }}>
                          {u.toUpperCase()}
                        </Text>
                      </View>
                      {Array.from({ length: sets }).map((_, i) => {
                        const k = key(ex.id, i);
                        const completed = done.has(k);
                        const isPR = prKeys.has(k);
                        const bad = invalid.has(k);
                        return (
                          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                            <Pressable
                              onPress={() => toggleSet(ex, i)}
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: theme.radii.md,
                                alignItems: 'center',
                                justifyContent: 'center',
                                backgroundColor: completed ? theme.colors.primary : theme.colors.surfaceElevated,
                                borderWidth: 1,
                                borderColor: completed ? theme.colors.primary : theme.colors.border,
                              }}
                            >
                              {completed ? (
                                <Icon name="checkmark" size={20} color={theme.colors.onPrimary} />
                              ) : (
                                <Text variant="bodyStrong" muted>
                                  {i + 1}
                                </Text>
                              )}
                            </Pressable>
                            <NumField
                              value={reps.get(k) ?? ''}
                              onChangeText={(v) => editField(setReps, k, v)}
                              onBlur={() => persistIfDone(ex, i)}
                              keyboardType="number-pad"
                              placeholder="reps"
                              invalid={bad}
                            />
                            <NumField
                              value={weight.get(k) ?? ''}
                              onChangeText={(v) => editField(setWeight, k, v)}
                              onBlur={() => persistIfDone(ex, i)}
                              keyboardType="decimal-pad"
                              placeholder={u}
                              invalid={bad}
                            />
                            <View style={{ height: 44, justifyContent: 'center' }}>
                              {isPR ? <Badge label="PR" tone="primary" /> : null}
                            </View>
                          </View>
                        );
                      })}
                      {hasInvalid ? (
                        <Text variant="caption" color="danger">
                          {t('workout.invalidHint')}
                        </Text>
                      ) : null}
                    </View>
                  )}
                </View>
              </Card>
            );
          })}

          {/* Notes already left this session */}
          {notes.length > 0 ? (
            <Card>
              <Text variant="label" muted style={{ marginBottom: theme.spacing.sm }}>
                {t('workout.notesTitle')}
              </Text>
              <View style={{ gap: theme.spacing.sm }}>
                {notes.map((n) => (
                  <View key={n.id} style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                      <Badge
                        label={n.category === 'challenge' ? t('workout.challenge') : t('workout.compliment')}
                        tone={n.category === 'challenge' ? 'warning' : 'success'}
                      />
                      {n.exercise_name ? (
                        <Text variant="caption" muted>
                          {n.exercise_name}
                        </Text>
                      ) : null}
                      <View style={{ flex: 1 }} />
                      <Text variant="label" muted style={{ fontSize: 10 }}>
                        {noteDate(n.created_at)}
                      </Text>
                      <Pressable
                        onPress={() => removeNote(n.id)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={t('workout.deleteNote')}
                      >
                        <Icon name="close" size={16} color={theme.colors.textMuted} />
                      </Pressable>
                    </View>
                    <Text variant="body">{n.body}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          <Button
            title={t('workout.leaveNote')}
            variant="ghost"
            left={<Icon name="chatbubble-ellipses-outline" size={18} color={theme.colors.link} />}
            onPress={() => openComposer({ scope: 'session' })}
          />
        </ScrollView>

        {/* Rest timer — floats just above the finish bar after a set completes */}
        {restEndsAt != null ? (
          <View
            style={{
              position: 'absolute',
              left: theme.spacing.lg,
              right: theme.spacing.lg,
              bottom: 104,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              backgroundColor: theme.colors.surfaceElevated,
              borderWidth: 1,
              borderColor: theme.colors.primary,
              borderRadius: theme.radii.md,
              paddingVertical: theme.spacing.md,
              paddingHorizontal: theme.spacing.lg,
            }}
          >
            <Icon name="clock" size={20} color={theme.colors.primary} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              {t('workout.restTimer', { time: fmtClock(restRemaining) })}
            </Text>
            <Pressable onPress={skipRest} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('workout.skip')}>
              <Text variant="label" color="primary">
                {t('workout.skip')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* Finish bar */}
        <View
          onLayout={(e) => setFinishBarH(e.nativeEvent.layout.height)}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: theme.spacing.lg,
            paddingBottom: theme.spacing.xl,
            backgroundColor: theme.colors.bg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          <Button
            title={doneCount > 0 ? t('workout.finish') : t('workout.markDone')}
            size="lg"
            loading={busy && celebrating}
            onPress={finish}
          />
        </View>
      </Screen>

      {/* Note composer. KeyboardAvoidingView lifts the sheet above the keyboard so
          the Send/Cancel buttons stay reachable; tapping the backdrop closes it and
          tapping the sheet dismisses the keyboard (so the user is never trapped). */}
      <Modal visible={composer !== null} transparent animationType="slide" onRequestClose={closeComposer}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable
            style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: theme.colors.overlay }}
            onPress={closeComposer}
          >
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
                <Text variant="title" style={{ flex: 1 }}>
                  {composer?.scope === 'exercise' ? composer.exName : t('workout.noteToCoach')}
                </Text>
                <Pressable onPress={closeComposer} hitSlop={8}>
                  <Icon name="close" size={24} color={theme.colors.textMuted} />
                </Pressable>
              </View>
              <Text variant="caption" muted>
                {t('workout.noteSub')}
              </Text>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Chip label={t('workout.challenge')} active={noteCat === 'challenge'} onPress={() => setNoteCat('challenge')} />
                <Chip label={t('workout.compliment')} active={noteCat === 'compliment'} onPress={() => setNoteCat('compliment')} />
              </View>
              <Input
                value={noteBody}
                onChangeText={setNoteBody}
                placeholder={t('workout.notePlaceholder')}
                multiline
                style={{ minHeight: 90, maxHeight: 140, textAlignVertical: 'top' }}
              />
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                <Button title={t('common.cancel')} variant="ghost" fullWidth={false} onPress={closeComposer} />
                <View style={{ flex: 1 }}>
                  <Button title={t('workout.saveNote')} onPress={saveNote} loading={savingNote} />
                </View>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Remove-note options (0060): hide from my log vs delete for everyone. */}
      <NoteDeleteSheet
        visible={noteMenuFor !== null}
        busy={false}
        onHide={() => {
          const id = noteMenuFor;
          setNoteMenuFor(null);
          if (id) hideNoteFromLog(id);
        }}
        onDeleteEveryone={() => {
          const id = noteMenuFor;
          setNoteMenuFor(null);
          if (id) deleteNoteEverywhere(id);
        }}
        onClose={() => setNoteMenuFor(null)}
      />

      {/* Celebration overlay */}
      {celebrating ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.overlay,
          }}
        >
          <Animated.View entering={ZoomIn.springify().damping(11)} style={{ alignItems: 'center', gap: theme.spacing.md }}>
            <View
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                backgroundColor: theme.colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="checkmark" size={72} color={theme.colors.onPrimary} />
            </View>
            <Text variant="h1" color="white">
              {fullyDone ? t('workout.complete') : t('workout.logged')}
            </Text>
          </Animated.View>
        </View>
      ) : null}
    </>
  );
}

function NumField({
  value,
  onChangeText,
  onBlur,
  keyboardType,
  placeholder,
  invalid,
}: {
  value: string;
  onChangeText: (v: string) => void;
  onBlur: () => void;
  keyboardType: 'number-pad' | 'decimal-pad';
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      keyboardType={keyboardType}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textMuted}
      style={{
        width: 72,
        textAlign: 'center',
        backgroundColor: theme.colors.surfaceElevated,
        borderWidth: 1,
        borderColor: invalid ? theme.colors.danger : theme.colors.border,
        borderRadius: theme.radii.sm,
        paddingVertical: theme.spacing.sm,
        color: theme.colors.text,
        fontFamily: theme.fontFamily.monoMedium,
        fontSize: 15,
      }}
    />
  );
}
