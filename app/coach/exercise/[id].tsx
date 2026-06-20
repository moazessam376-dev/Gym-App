// Coach → edit one exercise row in a day: block, sets, reps, rest, tempo, and a
// coach note for the trainee. Writes are RLS-gated (can_write_day).
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
  deleteExerciseRow,
  getExerciseRow,
  updateExerciseRow,
  type ExerciseRow,
} from '../../../src/lib/plans';
import { updateExerciseRowSchema, type TrainingBlock } from '../../../src/schemas/plan';
import { BLOCK_LABEL, BLOCK_ORDER } from '../../../src/lib/plan-ui';

// parseInt that maps blank/invalid to null (so a cleared field clears the value).
function intOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export default function ExerciseRowEditor() {
  const { role } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [row, setRow] = useState<ExerciseRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [block, setBlock] = useState<TrainingBlock>('primary');
  const [sets, setSets] = useState('');
  const [reps, setReps] = useState('');
  const [rest, setRest] = useState('');
  const [tempo, setTempo] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await getExerciseRow(id);
      setRow(r);
      if (r) {
        setBlock(r.block);
        setSets(r.sets?.toString() ?? '');
        setReps(r.reps ?? '');
        setRest(r.rest_seconds?.toString() ?? '');
        setTempo(r.tempo ?? '');
        setNote(r.note ?? '');
      }
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
  if (!row || !id) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Exercise not found.</Text>
      </View>
    );
  }

  async function onSave() {
    if (!id) return;
    const parsed = updateExerciseRowSchema.safeParse({
      block,
      sets: intOrNull(sets),
      reps: reps.trim() === '' ? null : reps.trim(),
      rest_seconds: intOrNull(rest),
      tempo: tempo.trim() === '' ? null : tempo.trim(),
      note: note.trim() === '' ? null : note.trim(),
    });
    if (!parsed.success) {
      Alert.alert('Check your input', 'Sets/rest must be whole numbers.');
      return;
    }
    setSaving(true);
    try {
      await updateExerciseRow(id, parsed.data);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save.');
      setSaving(false);
    }
  }

  function onDelete() {
    Alert.alert('Remove exercise', `Remove "${row!.exercise_name}" from this day?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExerciseRow(id!);
            router.back();
          } catch {
            Alert.alert('Error', 'Could not remove.');
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{row.exercise_name}</Text>

          <Text style={styles.label}>Block</Text>
          <View style={styles.blocks}>
            {BLOCK_ORDER.map((b) => (
              <Pressable
                key={b}
                style={[styles.blockChip, block === b && styles.blockChipActive]}
                onPress={() => setBlock(b)}
              >
                <Text style={[styles.blockChipText, block === b && styles.blockChipTextActive]}>
                  {BLOCK_LABEL[b]}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Sets</Text>
              <TextInput style={styles.input} value={sets} onChangeText={setSets} keyboardType="number-pad" placeholder="e.g. 4" />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Reps</Text>
              <TextInput style={styles.input} value={reps} onChangeText={setReps} placeholder="e.g. 8-12" />
            </View>
          </View>

          <View style={styles.twoCol}>
            <View style={styles.col}>
              <Text style={styles.label}>Rest (sec)</Text>
              <TextInput style={styles.input} value={rest} onChangeText={setRest} keyboardType="number-pad" placeholder="e.g. 120" />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Tempo</Text>
              <TextInput style={styles.input} value={tempo} onChangeText={setTempo} placeholder="e.g. 3-1-1-0" />
            </View>
          </View>

          <Text style={styles.label}>Note for the trainee</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={note}
            onChangeText={setNote}
            placeholder="Cues, e.g. Knees out, pause at bottom"
            multiline
          />

          <Pressable style={[styles.button, saving && styles.disabled]} onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
          </Pressable>
          <Pressable style={styles.deleteBtn} onPress={onDelete}>
            <Text style={styles.deleteText}>Remove exercise</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  wrap: { padding: 16, gap: 8 },
  title: { fontSize: 22, fontWeight: '800', color: '#111', marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '700', color: '#444', marginTop: 6 },
  blocks: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  blockChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#eef0f3' },
  blockChipActive: { backgroundColor: '#1f6feb' },
  blockChipText: { fontSize: 13, fontWeight: '600', color: '#6e7781' },
  blockChipTextActive: { color: '#fff' },
  twoCol: { flexDirection: 'row', gap: 10 },
  col: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteBtn: { paddingVertical: 14, alignItems: 'center' },
  deleteText: { color: '#cf222e', fontSize: 15, fontWeight: '600' },
  empty: { fontSize: 15, color: '#888' },
});
