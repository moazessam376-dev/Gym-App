// Client → my plans. RLS returns only this client's NON-draft plans, so there's
// nothing to filter for in the UI — what comes back is what they're allowed to see.
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
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { listPlansForClient, type Plan } from '../../src/lib/plans';
import { PLAN_STATUS_STYLE } from '../../src/lib/plan-ui';

export default function MyPlans() {
  const { role, session } = useAuth();
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = session?.user?.id;
  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setPlans(await listPlansForClient(userId));
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [userId]);

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

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={plans.length === 0 ? styles.emptyWrap : styles.listWrap}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        ListEmptyComponent={
          <Text style={styles.empty}>No plans yet. Your coach will share them here.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.planRow}
            onPress={() => router.push({ pathname: '/client/plan/[id]', params: { id: item.id } })}
          >
            <View style={styles.flex}>
              <Text style={styles.planTitle}>{item.title}</Text>
              <Text style={styles.planType}>{item.type}</Text>
            </View>
            {item.status === 'archived' ? (
              <View style={[styles.status, PLAN_STATUS_STYLE.archived]}>
                <Text style={styles.statusText}>archived</Text>
              </View>
            ) : null}
            <Text style={styles.chevron}>›</Text>
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
  emptyWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { fontSize: 15, color: '#888', textAlign: 'center' },
  flex: { flex: 1 },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f5f6f8',
  },
  planTitle: { fontSize: 16, color: '#111', fontWeight: '600' },
  planType: { fontSize: 13, color: '#6e7781', marginTop: 1, textTransform: 'capitalize' },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  chevron: { fontSize: 24, color: '#b0b7c0', marginLeft: 4 },
});
