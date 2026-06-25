// Coach → edit one food item in a meal: grams + a note. Writes RLS-gated
// (can_write_meal). Macros recompute from the grams against the snapshot.
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
          {t('mealItem.notFound')}
        </Text>
      </View>
    );
  }

  const preview = sumMacros([{ ...item, grams: intOr0(grams) }]);

  async function onSave() {
    if (!id) return;
    const g = intOr0(grams);
    if (g <= 0) {
      Alert.alert(t('mealItem.checkInputTitle'), t('mealItem.checkInputBody'));
      return;
    }
    const parsed = updateMealItemSchema.safeParse({ grams: g, note: note.trim() === '' ? null : note.trim() });
    if (!parsed.success) return;
    setSaving(true);
    try {
      await updateMealItem(id, parsed.data);
      router.back();
    } catch {
      Alert.alert(t('common.errorTitle'), t('mealItem.saveError'));
      setSaving(false);
    }
  }

  function onDelete() {
    Alert.alert(t('mealItem.removeTitle'), t('mealItem.removeConfirm', { name: item!.food_name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMealItem(id!);
            router.back();
          } catch {
            Alert.alert(t('common.errorTitle'), t('mealItem.removeError'));
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
              {t('mealItem.per100', {
                kcal: item.kcal_per_100g,
                p: item.protein_g_per_100g,
                c: item.carbs_g_per_100g,
                f: item.fat_g_per_100g,
              })}
            </Text>
          </View>

          <Input
            label={t('mealItem.grams')}
            value={grams}
            onChangeText={setGrams}
            keyboardType="number-pad"
            placeholder={t('mealItem.gramsPlaceholder')}
          />

          <GlassCard glowColor={theme.colors.primary}>
            <Text variant="title" color="primary">
              {t('mealItem.macroPreview', {
                kcal: preview.kcal,
                p: preview.protein,
                c: preview.carbs,
                f: preview.fat,
              })}
            </Text>
          </GlassCard>

          <Input
            label={t('mealItem.noteLabel')}
            value={note}
            onChangeText={setNote}
            placeholder={t('mealItem.notePlaceholder')}
            multiline
            style={{ minHeight: 70, textAlignVertical: 'top' }}
          />

          <Button title={t('common.save')} onPress={onSave} loading={saving} size="lg" style={{ marginTop: theme.spacing.sm }} />
          <Button title={t('mealItem.removeFood')} variant="ghost" onPress={onDelete} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
