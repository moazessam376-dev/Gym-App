// Coach → assign a template to one of their clients. Picking a client deep-clones
// the template into a new DRAFT plan for them (assign_plan_to_client RPC) and
// opens it so the coach can tweak the copy before publishing. id = template id.
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../../src/lib/auth-context';
import { listMyClients, type Client } from '../../../src/lib/invitations';
import { assignPlanToClient } from '../../../src/lib/plans';

export default function AssignTemplate() {
  const { role } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClients(await listMyClients());
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

  async function onAssign(client: Client) {
    if (!id || assigning) return;
    setError(null);
    setAssigning(true);
    try {
      const newId = await assignPlanToClient(id, client.id);
      // Replace so Back returns to the template, not this picker.
      router.replace({ pathname: '/coach/plan/[id]', params: { id: newId } });
    } catch {
      setError('Could not assign the plan. Please try again.');
      setAssigning(false);
    }
  }

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
        ListHeaderComponent={
          <View>
            <Text style={styles.lead}>Assign this template to a client. They get their own
              editable copy as a draft — publish it when you’re ready.</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {assigning ? <ActivityIndicator style={{ marginVertical: 8 }} /> : null}
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No clients yet. Invite one first.</Text>}
        renderItem={({ item }) => {
          const label = item.full_name ?? item.invited_email ?? 'Client';
          return (
            <Pressable style={styles.row} onPress={() => onAssign(item)} disabled={assigning}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{label.trim().charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={styles.name}>{label}</Text>
            </Pressable>
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
  lead: { fontSize: 14, color: '#57606a', marginBottom: 10 },
  error: { color: '#cf222e', fontSize: 13, marginBottom: 6 },
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
  name: { fontSize: 16, color: '#111', fontWeight: '600' },
});
