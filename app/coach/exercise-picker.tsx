// Coach → pick an exercise from the library to add to a day. Browse globals +
// own customs, filter by muscle group, or create a custom one inline. Tapping an
// exercise adds it to the day (snapshotting its name) and returns. The day id
// comes in as a route param.
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { createExercise, listExercises, type Exercise } from '../../src/lib/library';
import { createExerciseRow } from '../../src/lib/plans';
import { createExerciseSchema, muscleGroupSchema, type MuscleGroup } from '../../src/schemas/library';

const GROUPS = muscleGroupSchema.options;

export default function ExercisePicker() {
  const { role, session } = useAuth();
  const router = useRouter();
  const { dayId } = useLocalSearchParams<{ dayId: string }>();

  const [filter, setFilter] = useState<MuscleGroup | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customGroup, setCustomGroup] = useState<MuscleGroup>('push');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setExercises(await listExercises(filter ? { muscleGroup: filter } : undefined));
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function onPick(ex: Exercise) {
    if (!dayId || adding) return;
    setError(null);
    setAdding(true);
    try {
      await createExerciseRow({ day_id: dayId, exercise_id: ex.id, exercise_name: ex.name });
      router.back();
    } catch (e) {
      // The DB accepts this insert (verified); a failure here is a client/network
      // edge. Log the real cause so it's diagnosable, show the user a generic msg.
      console.warn('add library exercise failed', e);
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
      // Immediately add the new custom exercise to the day.
      if (dayId) await createExerciseRow({ day_id: dayId, exercise_id: created.id, exercise_name: created.name });
      router.back();
    } catch (e) {
      console.warn('create custom exercise failed', e);
      setError('Could not create the exercise.');
      setAdding(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={loading ? [] : exercises}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.listWrap}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.head}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={[null, ...GROUPS]}
                keyExtractor={(g) => g ?? 'all'}
                contentContainerStyle={styles.chips}
                renderItem={({ item: g }) => (
                  <Pressable
                    style={[styles.chip, filter === g && styles.chipActive]}
                    onPress={() => setFilter(g)}
                  >
                    <Text style={[styles.chipText, filter === g && styles.chipTextActive]}>
                      {g ?? 'All'}
                    </Text>
                  </Pressable>
                )}
              />

              <Pressable style={styles.customToggle} onPress={() => setShowCustom((s) => !s)}>
                <Text style={styles.customToggleText}>
                  {showCustom ? '× Cancel custom' : '＋ Create a custom exercise'}
                </Text>
              </Pressable>
              {showCustom ? (
                <View style={styles.customBox}>
                  <TextInput
                    style={styles.input}
                    value={customName}
                    onChangeText={setCustomName}
                    placeholder="Exercise name"
                    editable={!adding}
                  />
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={GROUPS}
                    keyExtractor={(g) => g}
                    contentContainerStyle={styles.chips}
                    renderItem={({ item: g }) => (
                      <Pressable
                        style={[styles.chip, customGroup === g && styles.chipActive]}
                        onPress={() => setCustomGroup(g)}
                      >
                        <Text style={[styles.chipText, customGroup === g && styles.chipTextActive]}>{g}</Text>
                      </Pressable>
                    )}
                  />
                  <Pressable style={styles.button} onPress={onCreateCustom} disabled={adding}>
                    <Text style={styles.buttonText}>Create &amp; add</Text>
                  </Pressable>
                </View>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          }
          ListEmptyComponent={
            loading ? <ActivityIndicator style={{ marginTop: 24 }} /> : <Text style={styles.empty}>No exercises.</Text>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => onPick(item)} disabled={adding}>
              <View style={styles.flex}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.muscle_group}
                  {item.primary_muscle ? ` · ${item.primary_muscle}` : ''}
                  {item.coach_id ? ' · custom' : ''}
                </Text>
              </View>
              <Text style={styles.add}>＋</Text>
            </Pressable>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  listWrap: { padding: 16, gap: 8 },
  head: { gap: 8, marginBottom: 2 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#eef0f3' },
  chipActive: { backgroundColor: '#1f6feb' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#6e7781', textTransform: 'capitalize' },
  chipTextActive: { color: '#fff' },
  customToggle: { paddingVertical: 6 },
  customToggleText: { color: '#1f6feb', fontWeight: '600', fontSize: 15 },
  customBox: { gap: 8, backgroundColor: '#f5f6f8', borderRadius: 12, padding: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
    backgroundColor: '#fff',
  },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  error: { color: '#cf222e', fontSize: 13 },
  empty: { fontSize: 14, color: '#888', paddingHorizontal: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f5f6f8',
  },
  name: { fontSize: 16, fontWeight: '600', color: '#111' },
  meta: { fontSize: 13, color: '#6e7781', marginTop: 1, textTransform: 'capitalize' },
  add: { fontSize: 22, color: '#1f6feb', fontWeight: '700' },
});
