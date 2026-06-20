// Client → plan detail (read-only). RLS only returns the plan + its items if this
// plan is a non-draft plan assigned to this client, so there's no edit surface.
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { getPlan, listPlanItems, type Plan, type PlanItem } from '../../../src/lib/plans';

export default function ClientPlanDetail() {
  const { role } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [p, its] = await Promise.all([getPlan(id), listPlanItems(id)]);
      setPlan(p);
      setItems(its);
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'client') return <Redirect href="/" />;

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
        <Text style={styles.empty}>This plan isn’t available.</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={styles.listWrap}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>{plan.title}</Text>
            <Text style={styles.type}>{plan.type}</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No items in this plan yet.</Text>}
        renderItem={({ item, index }) => (
          <View style={styles.itemRow}>
            <View style={styles.num}>
              <Text style={styles.numText}>{index + 1}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.itemName}>{item.name}</Text>
              {item.notes ? <Text style={styles.itemNotes}>{item.notes}</Text> : null}
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  listWrap: { padding: 16, gap: 10 },
  header: { marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '800', color: '#111' },
  type: { fontSize: 14, color: '#6e7781', marginTop: 2, textTransform: 'capitalize' },
  empty: { fontSize: 15, color: '#888', textAlign: 'center', paddingHorizontal: 4 },
  flex: { flex: 1 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f5f6f8',
  },
  num: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1f6feb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  numText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  itemName: { fontSize: 16, color: '#111', fontWeight: '600' },
  itemNotes: { fontSize: 13, color: '#6e7781', marginTop: 2 },
});
