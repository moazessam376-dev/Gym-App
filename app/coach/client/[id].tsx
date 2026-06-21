// Coach → one client's assigned plans. Plans are no longer created here — the
// coach builds TEMPLATES and assigns copies (a template → "Assign to a client").
// This screen lists what this client already has; tapping a plan opens the editor
// (tweak / publish). The "Assign from templates" button starts the assign flow.
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { listPlansForClient, type Plan } from '../../../src/lib/plans';
import { PLAN_STATUS_STYLE } from '../../../src/lib/plan-ui';

export default function ClientPlans() {
  const { role } = useAuth();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setPlans(await listPlansForClient(id));
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

  if (role && role !== 'coach') return <Redirect href="/" />;
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listWrap}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        ListHeaderComponent={
          <View style={styles.head}>
            <Text style={styles.client}>{name ?? 'Client'}</Text>
            <Pressable style={styles.assignBtn} onPress={() => router.push('/coach/templates')}>
              <Text style={styles.assignText}>Assign from templates</Text>
            </Pressable>
            <Text style={styles.sectionTitle}>Assigned plans</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No plans assigned yet.</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push({ pathname: '/coach/plan/[id]', params: { id: item.id } })}
          >
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowType}>{item.type}</Text>
            </View>
            <View style={[styles.status, PLAN_STATUS_STYLE[item.status]]}>
              <Text style={styles.statusText}>{item.status}</Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  listWrap: { padding: 16, gap: 10 },
  head: { gap: 10, marginBottom: 2 },
  client: { fontSize: 22, fontWeight: '800', color: '#111' },
  assignBtn: { backgroundColor: '#6f42c1', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  assignText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginTop: 8 },
  empty: { fontSize: 14, color: '#888', paddingHorizontal: 4 },
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f5f6f8',
  },
  rowTitle: { fontSize: 16, color: '#111', fontWeight: '600' },
  rowType: { fontSize: 13, color: '#6e7781', marginTop: 1, textTransform: 'capitalize' },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
});
