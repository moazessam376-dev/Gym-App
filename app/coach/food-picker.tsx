// Coach → pick a food from the library to add to a meal. Browse globals + own
// customs or create a custom food (per-100g macros). Picking a food asks for
// grams, then adds it to the meal (snapshotting name + macros).
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { createFood, listFoods, type Food } from '../../src/lib/library';
import { createMealItem } from '../../src/lib/plans';
import { createFoodSchema } from '../../src/schemas/library';
import { Screen, Text, Input, Button, GlassCard } from '../../src/components/ui';
import { theme } from '../../src/theme';

function intOr0(s: string): number {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export default function FoodPicker() {
  const { role, session } = useAuth();
  const router = useRouter();
  const { mealId } = useLocalSearchParams<{ mealId: string }>();

  const [foods, setFoods] = useState<Food[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Food | null>(null);
  const [grams, setGrams] = useState('100');
  const [busy, setBusy] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cName, setCName] = useState('');
  const [cKcal, setCKcal] = useState('');
  const [cP, setCP] = useState('');
  const [cC, setCC] = useState('');
  const [cF, setCF] = useState('');

  const load = useCallback(async () => {
    try {
      setFoods(await listFoods());
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function onAdd() {
    if (!mealId || !selected) return;
    const g = intOr0(grams);
    if (g <= 0) {
      setError('Enter grams.');
      return;
    }
    setBusy(true);
    try {
      await createMealItem({
        meal_id: mealId,
        food_id: selected.id,
        food_name: selected.name,
        kcal_per_100g: selected.kcal_per_100g,
        protein_g_per_100g: selected.protein_g_per_100g,
        carbs_g_per_100g: selected.carbs_g_per_100g,
        fat_g_per_100g: selected.fat_g_per_100g,
        grams: g,
      });
      router.back();
    } catch {
      setError('Could not add that food.');
      setBusy(false);
    }
  }

  async function onCreateCustom() {
    setError(null);
    const parsed = createFoodSchema.safeParse({
      name: cName.trim(),
      kcal_per_100g: intOr0(cKcal),
      protein_g_per_100g: intOr0(cP),
      carbs_g_per_100g: intOr0(cC),
      fat_g_per_100g: intOr0(cF),
    });
    if (!parsed.success) {
      setError('Enter a name and valid macro numbers.');
      return;
    }
    if (!session?.user?.id) return;
    setBusy(true);
    try {
      const created = await createFood(session.user.id, parsed.data);
      setShowCustom(false);
      setSelected(created);
      setCName('');
      setCKcal('');
      setCP('');
      setCC('');
      setCF('');
      await load();
    } catch {
      setError('Could not create the food.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={loading ? [] : foods}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.xs }}>
              {selected ? (
                <GlassCard glowColor={theme.colors.primary} style={{ gap: theme.spacing.md }}>
                  <View>
                    <Text variant="title">{selected.name}</Text>
                    <Text variant="caption" color="primary">
                      {selected.kcal_per_100g} kcal · {selected.protein_g_per_100g}P / {selected.carbs_g_per_100g}C / {selected.fat_g_per_100g}F per 100g
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.spacing.sm }}>
                    <Input containerStyle={{ flex: 1 }} label="Grams" value={grams} onChangeText={setGrams} keyboardType="number-pad" placeholder="grams" />
                    <Button title="Add" fullWidth={false} onPress={onAdd} loading={busy} />
                  </View>
                  <Pressable onPress={() => setSelected(null)}>
                    <Text variant="caption" color="link">
                      Choose a different food
                    </Text>
                  </Pressable>
                </GlassCard>
              ) : (
                <Button
                  title={showCustom ? 'Cancel custom' : 'Create a custom food'}
                  variant="ghost"
                  onPress={() => setShowCustom((s) => !s)}
                />
              )}

              {showCustom && !selected ? (
                <GlassCard style={{ gap: theme.spacing.md }}>
                  <Input value={cName} onChangeText={setCName} placeholder="Food name" />
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                    <Input containerStyle={{ flex: 1 }} value={cKcal} onChangeText={setCKcal} keyboardType="number-pad" placeholder="kcal" style={{ textAlign: 'center' }} />
                    <Input containerStyle={{ flex: 1 }} value={cP} onChangeText={setCP} keyboardType="number-pad" placeholder="P" style={{ textAlign: 'center' }} />
                    <Input containerStyle={{ flex: 1 }} value={cC} onChangeText={setCC} keyboardType="number-pad" placeholder="C" style={{ textAlign: 'center' }} />
                    <Input containerStyle={{ flex: 1 }} value={cF} onChangeText={setCF} keyboardType="number-pad" placeholder="F" style={{ textAlign: 'center' }} />
                  </View>
                  <Text variant="caption" muted>
                    Per 100g.
                  </Text>
                  <Button title="Create food" onPress={onCreateCustom} loading={busy} />
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
                No foods.
              </Text>
            )
          }
          renderItem={({ item }) => {
            const isSel = selected?.id === item.id;
            return (
              <GlassCard onPress={() => setSelected(item)} glowColor={isSel ? theme.colors.primary : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyStrong">{item.name}</Text>
                    <Text variant="caption" muted>
                      {item.kcal_per_100g} kcal · {item.protein_g_per_100g}P / {item.carbs_g_per_100g}C / {item.fat_g_per_100g}F
                      {item.coach_id ? ' · custom' : ''}
                    </Text>
                  </View>
                  <Ionicons name={isSel ? 'checkmark-circle' : 'add-circle'} size={24} color={theme.colors.primary} />
                </View>
              </GlassCard>
            );
          }}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
