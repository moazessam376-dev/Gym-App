// Workout logging — the satisfying part. The client taps to complete each set;
// the ring at the top fills as they go, and finishing fires a celebration. Every
// tap writes an exercise_set_logs row (migration 0016); finishing completes the
// workout_sessions row that powers streaks/adherence/leaderboard.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { listExerciseRows, type ExerciseRow } from '../../../src/lib/plans';
import { BLOCK_LABEL } from '../../../src/lib/plan-ui';
import {
  completeSession,
  createSession,
  deleteSetLog,
  getSessionForDay,
  listSetLogs,
  logSet,
  todayLocalDate,
  type WorkoutSession,
} from '../../../src/lib/sessions';
import { Screen, Text, Card, Badge, Button, ProgressRing } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

const key = (exerciseId: string, setIndex: number) => `${exerciseId}:${setIndex}`;

export default function WorkoutScreen() {
  const { dayId, planId, name } = useLocalSearchParams<{
    dayId: string;
    planId?: string;
    name?: string;
  }>();
  const { role, session: auth } = useAuth();
  const router = useRouter();
  const userId = auth?.user?.id;

  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [session, setSession] = useState<WorkoutSession | null>(null);
  // key -> set log id (presence = completed)
  const [done, setDone] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !dayId) return;
    try {
      const rows = await listExerciseRows(dayId);
      setExercises(rows);
      const existing = await getSessionForDay(userId, dayId, todayLocalDate());
      setSession(existing);
      if (existing) {
        const logs = await listSetLogs(existing.id);
        const m = new Map<string, string>();
        for (const l of logs) {
          if (l.is_completed && l.plan_exercise_id) m.set(key(l.plan_exercise_id, l.set_index), l.id);
        }
        setDone(m);
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

  const totalPlanned = useMemo(
    () => exercises.reduce((sum, e) => sum + (e.sets ?? 0), 0),
    [exercises],
  );
  const doneCount = done.size;
  const progress = totalPlanned > 0 ? doneCount / totalPlanned : 0;

  // Create the session lazily on the first set tap (no empty sessions).
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

  async function toggleSet(ex: ExerciseRow, setIndex: number) {
    if (busy) return;
    const k = key(ex.id, setIndex);
    setBusy(true);
    try {
      const existingId = done.get(k);
      if (existingId) {
        await deleteSetLog(existingId);
        setDone((prev) => {
          const next = new Map(prev);
          next.delete(k);
          return next;
        });
      } else {
        const s = await ensureSession();
        const row = await logSet({
          session_id: s.id,
          plan_exercise_id: ex.id,
          exercise_name: ex.exercise_name,
          set_index: setIndex,
          is_completed: true,
        });
        setDone((prev) => new Map(prev).set(k, row.id));
      }
    } catch {
      /* swallow — UI stays consistent on next load */
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      const s = await ensureSession();
      await completeSession(s.id);
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
      <Stack.Screen options={{ title: name ?? 'Workout' }} />
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
            <Text variant="title">{name ?? 'Workout'}</Text>
            <Text variant="caption" muted>
              {doneCount}/{totalPlanned} sets complete
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {exercises.map((ex) => {
            const sets = ex.sets ?? 0;
            return (
              <Card key={ex.id}>
                <View style={{ gap: theme.spacing.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="title">{ex.exercise_name}</Text>
                      <Text variant="caption" muted>
                        {sets} × {ex.reps ?? '—'}
                        {ex.rest_seconds ? ` · ${ex.rest_seconds}s rest` : ''}
                      </Text>
                    </View>
                    <Badge label={BLOCK_LABEL[ex.block]} tone="secondary" />
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
                      <Ionicons name="chatbubble-ellipses" size={16} color={theme.colors.primary} />
                      <Text variant="caption" style={{ flex: 1 }}>
                        {ex.note}
                      </Text>
                    </View>
                  ) : null}

                  {/* Set pills */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
                    {Array.from({ length: sets }).map((_, i) => {
                      const completed = done.has(key(ex.id, i));
                      return (
                        <Pressable
                          key={i}
                          onPress={() => toggleSet(ex, i)}
                          style={({ pressed }) => ({
                            width: 48,
                            height: 48,
                            borderRadius: theme.radii.md,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: completed ? theme.colors.primary : theme.colors.surfaceElevated,
                            borderWidth: 1,
                            borderColor: completed ? theme.colors.primary : theme.colors.border,
                            opacity: pressed ? 0.7 : 1,
                          })}
                        >
                          {completed ? (
                            <Ionicons name="checkmark" size={22} color={theme.colors.onPrimary} />
                          ) : (
                            <Text variant="bodyStrong" muted>
                              {i + 1}
                            </Text>
                          )}
                        </Pressable>
                      );
                    })}
                    {sets === 0 ? (
                      <Text variant="caption" muted>
                        No sets prescribed
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Card>
            );
          })}
        </ScrollView>

        {/* Finish bar */}
        <View
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
            title={doneCount > 0 ? 'Finish workout 💥' : 'Mark as done'}
            size="lg"
            loading={busy && celebrating}
            onPress={finish}
          />
        </View>
      </Screen>

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
          <Animated.View
            entering={ZoomIn.springify().damping(11)}
            style={{ alignItems: 'center', gap: theme.spacing.md }}
          >
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
              <Ionicons name="checkmark" size={72} color={theme.colors.onPrimary} />
            </View>
            <Text variant="h1" color="white">
              Workout Crushed 💥
            </Text>
          </Animated.View>
        </View>
      ) : null}
    </>
  );
}
