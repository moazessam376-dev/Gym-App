// Coach → pick a food from the library to add to a meal. Browse globals + own
// customs or create a custom food (with per-100g macros). Picking a food asks
// for grams, then adds it to the meal (snapshotting name + macros). meal id is a
// route param.
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
import { createFood, listFoods, type Food } from '../../src/lib/library';
import { createMealItem } from '../../src/lib/plans';
import { createFoodSchema } from '../../src/schemas/library';

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

  // custom food form
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
      setSelected(created); // select it so the coach just sets grams + adds
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
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={loading ? [] : foods}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.listWrap}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.head}>
              {selected ? (
                <View style={styles.selectedBox}>
                  <Text style={styles.selectedName}>{selected.name}</Text>
                  <Text style={styles.selectedMacros}>
                    {selected.kcal_per_100g} kcal · {selected.protein_g_per_100g}P /{' '}
                    {selected.carbs_g_per_100g}C / {selected.fat_g_per_100g}F per 100g
                  </Text>
                  <View style={styles.gramsRow}>
                    <TextInput
                      style={[styles.input, styles.gramsInput]}
                      value={grams}
                      onChangeText={setGrams}
                      keyboardType="number-pad"
                      placeholder="grams"
                    />
                    <Text style={styles.gramsUnit}>g</Text>
                    <Pressable style={styles.addBtn} onPress={onAdd} disabled={busy}>
                      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.addBtnText}>Add</Text>}
                    </Pressable>
                  </View>
                  <Pressable onPress={() => setSelected(null)}>
                    <Text style={styles.changeText}>Choose a different food</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.customToggle} onPress={() => setShowCustom((s) => !s)}>
                  <Text style={styles.customToggleText}>
                    {showCustom ? '× Cancel custom' : '＋ Create a custom food'}
                  </Text>
                </Pressable>
              )}

              {showCustom && !selected ? (
                <View style={styles.customBox}>
                  <TextInput style={styles.input} value={cName} onChangeText={setCName} placeholder="Food name" />
                  <View style={styles.macroRow}>
                    <TextInput style={[styles.input, styles.macroInput]} value={cKcal} onChangeText={setCKcal} keyboardType="number-pad" placeholder="kcal" />
                    <TextInput style={[styles.input, styles.macroInput]} value={cP} onChangeText={setCP} keyboardType="number-pad" placeholder="P" />
                    <TextInput style={[styles.input, styles.macroInput]} value={cC} onChangeText={setCC} keyboardType="number-pad" placeholder="C" />
                    <TextInput style={[styles.input, styles.macroInput]} value={cF} onChangeText={setCF} keyboardType="number-pad" placeholder="F" />
                  </View>
                  <Text style={styles.hint}>Per 100g.</Text>
                  <Pressable style={styles.button} onPress={onCreateCustom} disabled={busy}>
                    <Text style={styles.buttonText}>Create food</Text>
                  </Pressable>
                </View>
              ) : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </View>
          }
          ListEmptyComponent={
            loading ? <ActivityIndicator style={{ marginTop: 24 }} /> : <Text style={styles.empty}>No foods.</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={[styles.row, selected?.id === item.id && styles.rowSelected]}
              onPress={() => setSelected(item)}
            >
              <View style={styles.flex}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.kcal_per_100g} kcal · {item.protein_g_per_100g}P / {item.carbs_g_per_100g}C /{' '}
                  {item.fat_g_per_100g}F{item.coach_id ? ' · custom' : ''}
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
  selectedBox: { backgroundColor: '#eef6ff', borderRadius: 12, padding: 14, gap: 8 },
  selectedName: { fontSize: 17, fontWeight: '700', color: '#111' },
  selectedMacros: { fontSize: 13, color: '#1f6feb', fontWeight: '600' },
  gramsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  gramsInput: { flex: 1, backgroundColor: '#fff' },
  gramsUnit: { fontSize: 16, color: '#6e7781' },
  addBtn: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 22, alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  changeText: { color: '#1f6feb', fontWeight: '600', fontSize: 14 },
  customToggle: { paddingVertical: 6 },
  customToggleText: { color: '#1f6feb', fontWeight: '600', fontSize: 15 },
  customBox: { gap: 8, backgroundColor: '#f5f6f8', borderRadius: 12, padding: 12 },
  macroRow: { flexDirection: 'row', gap: 8 },
  macroInput: { flex: 1, backgroundColor: '#fff', textAlign: 'center' },
  hint: { fontSize: 12, color: '#6e7781' },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
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
  rowSelected: { backgroundColor: '#dbeafe' },
  name: { fontSize: 16, fontWeight: '600', color: '#111' },
  meta: { fontSize: 13, color: '#6e7781', marginTop: 1 },
  add: { fontSize: 22, color: '#1f6feb', fontWeight: '700' },
});
