// Coach → edit one exercise row in a day: block, sets, reps, rest, tempo, and a
// coach note for the trainee. Writes are RLS-gated (can_write_day).
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { deleteExerciseRow, getExerciseRow, updateExerciseRow, type ExerciseRow } from '../../../src/lib/plans';
import { updateExerciseRowSchema, type TrainingBlock } from '../../../src/schemas/plan';
import { BLOCK_LABEL, BLOCK_ORDER } from '../../../src/lib/plan-ui';
import { Screen, Text, Input, Button } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }
  if (!row || !id) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <Text variant="body" muted>
          Exercise not found.
        </Text>
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
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }} keyboardShouldPersistTaps="handled">
          <Text variant="h2">{row.exercise_name}</Text>

          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="label" muted>
              Block
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {BLOCK_ORDER.map((b) => {
                const active = block === b;
                return (
                  <Pressable
                    key={b}
                    onPress={() => setBlock(b)}
                    style={{
                      borderRadius: theme.radii.full,
                      paddingHorizontal: theme.spacing.md,
                      paddingVertical: 7,
                      backgroundColor: active ? theme.colors.primary : theme.colors.glass,
                      borderWidth: 1,
                      borderColor: active ? theme.colors.primary : theme.colors.glassBorder,
                    }}
                  >
                    <Text variant="caption" color={active ? theme.colors.onPrimary : theme.colors.textMuted} style={{ fontFamily: theme.fontFamily.bodySemiBold }}>
                      {BLOCK_LABEL[b]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Input label="Sets" containerStyle={{ flex: 1 }} value={sets} onChangeText={setSets} keyboardType="number-pad" placeholder="e.g. 4" />
            <Input label="Reps" containerStyle={{ flex: 1 }} value={reps} onChangeText={setReps} placeholder="e.g. 8-12" />
          </View>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Input label="Rest (sec)" containerStyle={{ flex: 1 }} value={rest} onChangeText={setRest} keyboardType="number-pad" placeholder="e.g. 120" />
            <Input label="Tempo" containerStyle={{ flex: 1 }} value={tempo} onChangeText={setTempo} placeholder="e.g. 3-1-1-0" />
          </View>

          <Input
            label="Note for the trainee"
            value={note}
            onChangeText={setNote}
            placeholder="Cues, e.g. Knees out, pause at bottom"
            multiline
            style={{ minHeight: 70, textAlignVertical: 'top' }}
          />

          <Button title="Save" onPress={onSave} loading={saving} size="lg" style={{ marginTop: theme.spacing.sm }} />
          <Button title="Remove exercise" variant="ghost" onPress={onDelete} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
