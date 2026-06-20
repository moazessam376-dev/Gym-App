// Admin → review pending coach applications. Approve flips the applicant to a
// coach; reject closes the request. Both go through the review-coach-application
// Edge Function (the only writer of status / role). RLS lets only an admin read
// these rows; the role guard keeps the UI honest.
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import {
  listPendingApplications,
  reviewApplication,
  type PendingApplication,
} from '../../src/lib/coach-applications';

export default function AdminApplications() {
  const { role } = useAuth();
  const [apps, setApps] = useState<PendingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setApps(await listPendingApplications());
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

  if (role && role !== 'admin') return <Redirect href="/" />;

  async function decide(app: PendingApplication, approve: boolean) {
    setBusyId(app.id);
    try {
      await reviewApplication(app.id, approve);
      await load();
    } catch {
      Alert.alert('Error', 'Could not complete the review. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  function confirm(app: PendingApplication, approve: boolean) {
    const who = app.applicant_name ?? 'this applicant';
    Alert.alert(
      approve ? 'Approve coach' : 'Reject application',
      approve
        ? `Make ${who} a coach? They'll switch to a coach account.`
        : `Reject ${who}'s application?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: approve ? 'Approve' : 'Reject',
          style: approve ? 'default' : 'destructive',
          onPress: () => decide(app, approve),
        },
      ],
    );
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
        data={apps}
        keyExtractor={(a) => a.id}
        contentContainerStyle={apps.length === 0 ? styles.emptyWrap : styles.listWrap}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
        ListEmptyComponent={<Text style={styles.empty}>No pending applications.</Text>}
        renderItem={({ item }) => {
          const busy = busyId === item.id;
          return (
            <View style={styles.card}>
              <Text style={styles.name}>{item.applicant_name ?? 'Unnamed applicant'}</Text>
              {item.message ? <Text style={styles.message}>“{item.message}”</Text> : null}
              <Text style={styles.date}>applied {new Date(item.created_at).toLocaleDateString()}</Text>
              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.reject, busy && styles.disabled]}
                  onPress={() => confirm(item, false)}
                  disabled={busy}
                >
                  <Text style={styles.rejectText}>Reject</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.approve, busy && styles.disabled]}
                  onPress={() => confirm(item, true)}
                  disabled={busy}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveText}>Approve</Text>}
                </Pressable>
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
  card: { backgroundColor: '#f5f6f8', borderRadius: 14, padding: 16, gap: 6 },
  name: { fontSize: 17, fontWeight: '700', color: '#111' },
  message: { fontSize: 14, color: '#444', fontStyle: 'italic' },
  date: { fontSize: 12, color: '#6e7781' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  approve: { backgroundColor: '#1a7f37' },
  approveText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  reject: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#cf222e' },
  rejectText: { color: '#cf222e', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.6 },
});
