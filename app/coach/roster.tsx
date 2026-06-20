// Coach roster — the coach's list of clients.
//
// No new schema: RLS on `profiles` (is_coach_of) already limits rows to this
// coach's clients, so a plain select is safe. A client who reached this screen
// would simply get their own row back (and the role guard sends them home).
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { listMyClients, type Client } from '../../src/lib/invitations';

export default function Roster() {
  const { role } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setClients(await listMyClients());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload each time the screen gains focus (e.g. after accepting an invite).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Coach-only screen. RLS protects the data regardless, but keep the UI honest.
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
        data={clients}
        keyExtractor={(c) => c.id}
        contentContainerStyle={clients.length === 0 ? styles.emptyWrap : styles.listWrap}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {error
              ? 'Could not load your clients. Pull to retry.'
              : 'No clients yet. Invite one from the dashboard.'}
          </Text>
        }
        renderItem={({ item }) => {
          const label = item.full_name ?? item.invited_email ?? 'Client';
          return (
            <View style={styles.row}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{label.trim().charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.name}>{label}</Text>
                {item.full_name && item.invited_email ? (
                  <Text style={styles.sub}>{item.invited_email}</Text>
                ) : null}
              </View>
            </View>
          );
        }}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f5f6f8',
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1f6feb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  flex: { flex: 1 },
  name: { fontSize: 16, color: '#111', fontWeight: '600' },
  sub: { fontSize: 13, color: '#6e7781', marginTop: 1 },
});
