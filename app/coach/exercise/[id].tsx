// Coach → edit one exercise row in a day: block, sets, reps, rest, tempo, and a
// coach note for the trainee. Writes are RLS-gated (can_write_day).
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../src/lib/auth-context';
import { textStart } from '../../../src/lib/rtl';
import { deleteExerciseRow, getDayPlanClient, getExerciseRow, swapPlanExercise, updateExerciseRow, type ExerciseRow } from '../../../src/lib/plans';
import { suggestExerciseSwap, type SwapSuggestion } from '../../../src/lib/coach-ai';
import { updateExerciseRowSchema, type TrainingBlock } from '../../../src/schemas/plan';
import { BLOCK_LABEL, BLOCK_ORDER } from '../../../src/lib/plan-ui';
import { Screen, Text, Input, Button, GlassCard } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

function intOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export default function ExerciseRowEditor() {
  const { t } = useTranslation();
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

  // Injury-aware AI swap (Phase 13) — only when this exercise is in a client's plan.
  const [clientId, setClientId] = useState<string | null>(null);
  const [swaps, setSwaps] = useState<SwapSuggestion[] | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);

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
        setClientId(await getDayPlanClient(r.day_id).catch(() => null));
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
          {t('exerciseEditor.notFound')}
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
      Alert.alert(t('common.checkInput'), t('exerciseEditor.setsRestError'));
      return;
    }
    setSaving(true);
    try {
      await updateExerciseRow(id, parsed.data);
      router.back();
    } catch {
      Alert.alert(t('common.errorTitle'), t('exerciseEditor.saveError'));
      setSaving(false);
    }
  }

  async function onSuggestSwap() {
    if (!id || !row || !clientId || swapBusy) return;
    setSwapBusy(true);
    try {
      const res = await suggestExerciseSwap({ clientId, exerciseId: row.exercise_id });
      if (res.status === 'suggested' && res.suggestions) {
        setSwaps(res.suggestions);
      } else if (res.status === 'rate_limited') {
        Alert.alert(t('exerciseEditor.dailyLimitTitle'), t('exerciseEditor.dailyLimitBody'));
      } else {
        Alert.alert(t('exerciseEditor.noSuggestionsTitle'), t('exerciseEditor.noSuggestionsBody'));
      }
    } finally {
      setSwapBusy(false);
    }
  }

  function onApplySwap(s: SwapSuggestion) {
    Alert.alert(t('exerciseEditor.swapTitle'), t('exerciseEditor.swapConfirm', { from: row!.exercise_name, to: s.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('exerciseEditor.swapAction'),
        onPress: async () => {
          try {
            await swapPlanExercise(id!, s.exercise_id, s.name);
            router.back();
          } catch {
            Alert.alert(t('common.errorTitle'), t('exerciseEditor.swapError'));
          }
        },
      },
    ]);
  }

  function onDelete() {
    Alert.alert(t('exerciseEditor.removeTitle'), t('exerciseEditor.removeConfirm', { name: row!.exercise_name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExerciseRow(id!);
            router.back();
          } catch {
            Alert.alert(t('common.errorTitle'), t('exerciseEditor.removeError'));
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
            <Text variant="label" muted style={textStart}>
              {t('exerciseEditor.block')}
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
            <Input label={t('exerciseEditor.sets')} containerStyle={{ flex: 1 }} value={sets} onChangeText={setSets} keyboardType="number-pad" placeholder={t('exerciseEditor.setsPlaceholder')} />
            <Input label={t('exerciseEditor.reps')} containerStyle={{ flex: 1 }} value={reps} onChangeText={setReps} placeholder={t('exerciseEditor.repsPlaceholder')} />
          </View>
          <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
            <Input label={t('exerciseEditor.rest')} containerStyle={{ flex: 1 }} value={rest} onChangeText={setRest} keyboardType="number-pad" placeholder={t('exerciseEditor.restPlaceholder')} />
            <Input label={t('exerciseEditor.tempo')} containerStyle={{ flex: 1 }} value={tempo} onChangeText={setTempo} placeholder={t('exerciseEditor.tempoPlaceholder')} />
          </View>

          <Input
            label={t('exerciseEditor.noteLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('exerciseEditor.notePlaceholder')}
            multiline
            style={{ minHeight: 70, textAlignVertical: 'top' }}
          />

          {/* Injury-aware AI swap — only for an exercise inside a client's plan. */}
          {clientId ? (
            <View style={{ gap: theme.spacing.sm }}>
              <Button
                title={t('exerciseEditor.suggestSwap')}
                variant="ghost"
                left={<Ionicons name="sparkles" size={16} color={theme.colors.primary} />}
                onPress={onSuggestSwap}
                loading={swapBusy}
              />
              {swaps?.map((s) => (
                <GlassCard key={s.exercise_id} onPress={() => onApplySwap(s)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{s.name}</Text>
                      <Text variant="caption" muted>
                        {s.reason}
                      </Text>
                    </View>
                    <Text variant="caption" color="primary">
                      {t('exerciseEditor.swapAction')} ›
                    </Text>
                  </View>
                </GlassCard>
              ))}
            </View>
          ) : null}

          <Button title={t('common.save')} onPress={onSave} loading={saving} size="lg" style={{ marginTop: theme.spacing.sm }} />
          <Button title={t('exerciseEditor.removeExercise')} variant="ghost" onPress={onDelete} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
