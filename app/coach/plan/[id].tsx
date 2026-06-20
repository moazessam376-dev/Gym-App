// Coach → plan detail. Edit the item list and flip draft ⇄ published. All writes
// go through RLS (can_write_plan → only the authoring coach).
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import {
  createPlanItem,
  deletePlanItem,
  getPlan,
  listPlanItems,
  setPlanStatus,
  type Plan,
  type PlanItem,
} from '../../../src/lib/plans';
import { PLAN_STATUS_STYLE } from '../../../src/lib/plan-ui';

export default function PlanDetail() {
  const { role } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, its] = await Promise.all([getPlan(id), listPlanItems(id)]);
      setPlan(p);
      setItems(its);
    } catch {
      /* keep prior state */
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

  async function onAddItem() {
    setError(null);
    if (!id || name.trim().length === 0) {
      setError('Enter an item name.');
      return;
    }
    setBusy(true);
    try {
      await createPlanItem({ plan_id: id, name: name.trim(), notes: notes.trim() || null });
      setName('');
      setNotes('');
      await load();
    } catch {
      setError('Could not add the item.');
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePublish() {
    if (!plan) return;
    const next = plan.status === 'published' ? 'draft' : 'published';
    setBusy(true);
    try {
      await setPlanStatus(plan.id, next);
      await load();
    } catch {
      setError('Could not update the plan status.');
    } finally {
      setBusy(false);
    }
  }

  function onDeleteItem(itemId: string) {
    Alert.alert('Remove item', 'Delete this item from the plan?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deletePlanItem(itemId);
            await load();
          } catch {
            setError('Could not remove the item.');
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>Plan not found.</Text>
      </View>
    );
  }

  const published = plan.status === 'published';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.listWrap}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.form}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>{plan.title}</Text>
                <View style={[styles.status, PLAN_STATUS_STYLE[plan.status]]}>
                  <Text style={styles.statusText}>{plan.status}</Text>
                </View>
              </View>
              <Text style={styles.type}>{plan.type}</Text>

              <Pressable
                style={[styles.publishBtn, published ? styles.unpublish : styles.publish]}
                onPress={onTogglePublish}
                disabled={busy}
              >
                <Text style={styles.publishText}>
                  {published ? 'Unpublish (back to draft)' : 'Publish to client'}
                </Text>
              </Pressable>

              <Text style={styles.sectionTitle}>Items</Text>
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No items yet. Add the first below.</Text>}
          renderItem={({ item }) => (
            <View style={styles.itemRow}>
              <View style={styles.flex}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
              </View>
              <Pressable hitSlop={10} onPress={() => onDeleteItem(item.id)}>
                <Text style={styles.remove}>✕</Text>
              </Pressable>
            </View>
          )}
          ListFooterComponent={
            <View style={styles.addBox}>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Item name (e.g. Squat 5×5)"
                editable={!busy}
              />
              <TextInput
                style={styles.input}
                value={notes}
                onChangeText={setNotes}
                placeholder="Notes (optional)"
                editable={!busy}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                style={[styles.button, busy && styles.buttonDisabled]}
                onPress={onAddItem}
                disabled={busy}
              >
                <Text style={styles.buttonText}>Add item</Text>
              </Pressable>
            </View>
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  listWrap: { padding: 16, gap: 10 },
  form: { gap: 6, marginBottom: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 22, fontWeight: '800', color: '#111' },
  type: { fontSize: 14, color: '#6e7781', textTransform: 'capitalize' },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  publishBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  publish: { backgroundColor: '#1a7f37' },
  unpublish: { backgroundColor: '#9a6700' },
  publishText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginTop: 14 },
  empty: { fontSize: 14, color: '#888', paddingHorizontal: 4 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f5f6f8',
  },
  itemName: { fontSize: 16, color: '#111', fontWeight: '600' },
  itemNotes: { fontSize: 13, color: '#6e7781', marginTop: 2 },
  remove: { fontSize: 18, color: '#cf222e', fontWeight: '700' },
  addBox: { gap: 8, marginTop: 14 },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  error: { color: '#cf222e', fontSize: 13 },
  button: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
