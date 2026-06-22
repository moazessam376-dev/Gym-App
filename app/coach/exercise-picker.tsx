// Coach → pick an exercise from the library to add to a day. Browse globals +
// own customs, filter by muscle group, or create a custom one inline.
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { createExercise, listExercises, type Exercise } from '../../src/lib/library';
import { createExerciseRow, listExerciseRows } from '../../src/lib/plans';
import { createExerciseSchema, muscleGroupSchema, type MuscleGroup } from '../../src/schemas/library';
import { Screen, Text, Input, Button, GlassCard, Chip } from '../../src/components/ui';
import { theme } from '../../src/theme';

const GROUPS = muscleGroupSchema.options;

export default function ExercisePicker() {
  const { role, session } = useAuth();
  const router = useRouter();
  const { dayId } = useLocalSearchParams<{ dayId: string }>();

  const [filter, setFilter] = useState<MuscleGroup | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  // exercise_ids already in this day — to block adding the same one twice.
  const [inDay, setInDay] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customGroup, setCustomGroup] = useState<MuscleGroup>('push');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, rows] = await Promise.all([
        listExercises(filter ? { muscleGroup: filter } : undefined),
        dayId ? listExerciseRows(dayId) : Promise.resolve([]),
      ]);
      setExercises(list);
      setInDay(new Set(rows.map((r) => r.exercise_id)));
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [filter, dayId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function onPick(ex: Exercise) {
    if (!dayId || adding) return;
    if (inDay.has(ex.id)) {
      setError(`${ex.name} is already in this day.`);
      return;
    }
    setError(null);
    setAdding(true);
    try {
      await createExerciseRow({ day_id: dayId, exercise_id: ex.id, exercise_name: ex.name });
      router.back();
    } catch (e) {
      if (__DEV__) console.warn('add library exercise failed', e);
      setError('Could not add that exercise.');
      setAdding(false);
    }
  }

  async function onCreateCustom() {
    setError(null);
    const parsed = createExerciseSchema.safeParse({ name: customName.trim(), muscle_group: customGroup });
    if (!parsed.success) {
      setError('Enter an exercise name.');
      return;
    }
    if (!session?.user?.id) return;
    setAdding(true);
    try {
      const created = await createExercise(session.user.id, parsed.data);
      if (dayId) await createExerciseRow({ day_id: dayId, exercise_id: created.id, exercise_name: created.name });
      router.back();
    } catch (e) {
      if (__DEV__) console.warn('create custom exercise failed', e);
      setError('Could not create the exercise.');
      setAdding(false);
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={loading ? [] : exercises}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={[null, ...GROUPS]}
                keyExtractor={(g) => g ?? 'all'}
                contentContainerStyle={{ gap: theme.spacing.sm, paddingVertical: 2 }}
                renderItem={({ item: g }) => (
                  <Chip label={g ?? 'All'} active={filter === g} onPress={() => setFilter(g)} />
                )}
              />

              <Button
                title={showCustom ? 'Cancel custom' : 'Create a custom exercise'}
                variant="ghost"
                onPress={() => setShowCustom((s) => !s)}
              />
              {showCustom ? (
                <GlassCard style={{ gap: theme.spacing.md }}>
                  <Input value={customName} onChangeText={setCustomName} placeholder="Exercise name" editable={!adding} />
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={GROUPS}
                    keyExtractor={(g) => g}
                    contentContainerStyle={{ gap: theme.spacing.sm }}
                    renderItem={({ item: g }) => (
                      <Chip label={g} active={customGroup === g} onPress={() => setCustomGroup(g)} />
                    )}
                  />
                  <Button title="Create & add" onPress={onCreateCustom} loading={adding} />
                </GlassCard>
              ) : null}
              {error ? (
                <Text variant="caption" color="danger">
                  {error}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />
            ) : (
              <Text variant="body" muted>
                No exercises.
              </Text>
            )
          }
          renderItem={({ item }) => {
            const added = inDay.has(item.id);
            return (
              <GlassCard onPress={() => onPick(item)} style={{ opacity: added ? 0.5 : 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{item.name}</Text>
                    <Text variant="caption" muted style={{ textTransform: 'capitalize' }}>
                      {item.muscle_group}
                      {item.primary_muscle ? ` · ${item.primary_muscle}` : ''}
                      {item.coach_id ? ' · custom' : ''}
                      {added ? ' · in day' : ''}
                    </Text>
                  </View>
                  <Ionicons
                    name={added ? 'checkmark-circle' : 'add-circle'}
                    size={24}
                    color={added ? theme.colors.textMuted : theme.colors.primary}
                  />
                </View>
              </GlassCard>
            );
          }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
