// Coach → edit one food item in a meal: grams + a note. Writes RLS-gated
// (can_write_meal). Macros recompute from the grams against the snapshot.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { deleteMealItem, getMealItem, updateMealItem, type MealItem } from '../../../src/lib/plans';
import { updateMealItemSchema } from '../../../src/schemas/plan';
import { sumMacros } from '../../../src/lib/plan-ui';
import { Screen, Text, Input, Button, GlassCard } from '../../../src/components/ui';
import { theme } from '../../../src/theme';

function intOr0(s: string): number {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export default function MealItemEditor() {
  const { role } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [item, setItem] = useState<MealItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [grams, setGrams] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const it = await getMealItem(id);
      setItem(it);
      if (it) {
        setGrams(it.grams.toString());
        setNote(it.note ?? '');
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
  if (!item || !id) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <Text variant="body" muted>
          Item not found.
        </Text>
      </View>
    );
  }

  const preview = sumMacros([{ ...item, grams: intOr0(grams) }]);

  async function onSave() {
    if (!id) return;
    const g = intOr0(grams);
    if (g <= 0) {
      Alert.alert('Check your input', 'Enter grams greater than 0.');
      return;
    }
    const parsed = updateMealItemSchema.safeParse({ grams: g, note: note.trim() === '' ? null : note.trim() });
    if (!parsed.success) return;
    setSaving(true);
    try {
      await updateMealItem(id, parsed.data);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not save.');
      setSaving(false);
    }
  }

  function onDelete() {
    Alert.alert('Remove food', `Remove "${item!.food_name}" from this meal?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMealItem(id!);
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
          <View>
            <Text variant="h2">{item.food_name}</Text>
            <Text variant="caption" muted>
              {item.kcal_per_100g} kcal · {item.protein_g_per_100g}P / {item.carbs_g_per_100g}C / {item.fat_g_per_100g}F per 100g
            </Text>
          </View>

          <Input label="Grams" value={grams} onChangeText={setGrams} keyboardType="number-pad" placeholder="e.g. 150" />

          <GlassCard glowColor={theme.colors.primary}>
            <Text variant="title" color="primary">
              {preview.kcal} kcal · {preview.protein}P / {preview.carbs}C / {preview.fat}F
            </Text>
          </GlassCard>

          <Input
            label="Note for the trainee"
            value={note}
            onChangeText={setNote}
            placeholder="e.g. cooked weight"
            multiline
            style={{ minHeight: 70, textAlignVertical: 'top' }}
          />

          <Button title="Save" onPress={onSave} loading={saving} size="lg" style={{ marginTop: theme.spacing.sm }} />
          <Button title="Remove food" variant="ghost" onPress={onDelete} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
