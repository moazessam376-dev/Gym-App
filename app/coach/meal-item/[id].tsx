// Coach → edit one food item in a meal: grams + a note. Writes RLS-gated
// (can_write_meal). Macros recompute from the grams against the snapshot.
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
import { deleteMealItem, getMealItem, updateMealItem, type MealItem } from '../../../src/lib/plans';
import { updateMealItemSchema } from '../../../src/schemas/plan';
import { sumMacros } from '../../../src/lib/plan-ui';

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
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!item || !id) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Item not found.</Text>
      </View>
    );
  }

  // Live macro preview for the entered grams.
  const preview = sumMacros([{ ...item, grams: intOr0(grams) }]);

  async function onSave() {
    if (!id) return;
    const g = intOr0(grams);
    if (g <= 0) {
      Alert.alert('Check your input', 'Enter grams greater than 0.');
      return;
    }
    const parsed = updateMealItemSchema.safeParse({
      grams: g,
      note: note.trim() === '' ? null : note.trim(),
    });
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
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{item.food_name}</Text>
          <Text style={styles.per100}>
            {item.kcal_per_100g} kcal · {item.protein_g_per_100g}P / {item.carbs_g_per_100g}C /{' '}
            {item.fat_g_per_100g}F per 100g
          </Text>

          <Text style={styles.label}>Grams</Text>
          <TextInput style={styles.input} value={grams} onChangeText={setGrams} keyboardType="number-pad" placeholder="e.g. 150" />

          <View style={styles.previewCard}>
            <Text style={styles.previewText}>
              {preview.kcal} kcal · {preview.protein}P / {preview.carbs}C / {preview.fat}F
            </Text>
          </View>

          <Text style={styles.label}>Note for the trainee</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. cooked weight"
            multiline
          />

          <Pressable style={[styles.button, saving && styles.disabled]} onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
          </Pressable>
          <Pressable style={styles.deleteBtn} onPress={onDelete}>
            <Text style={styles.deleteText}>Remove food</Text>
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
  title: { fontSize: 22, fontWeight: '800', color: '#111' },
  per100: { fontSize: 13, color: '#6e7781', marginBottom: 4 },
  label: { fontSize: 13, fontWeight: '700', color: '#444', marginTop: 6 },
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
  previewCard: { backgroundColor: '#eef6ff', borderRadius: 10, padding: 12, marginTop: 4 },
  previewText: { fontSize: 15, fontWeight: '700', color: '#1f6feb' },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteBtn: { paddingVertical: 14, alignItems: 'center' },
  deleteText: { color: '#cf222e', fontSize: 15, fontWeight: '600' },
  empty: { fontSize: 15, color: '#888' },
});
