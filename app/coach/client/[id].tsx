// Coach → a single client's plans. Lists the client's plans (drafts included,
// per RLS) and creates a new draft plan. Reached by tapping a roster row.
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
import { useAuth } from '../../../src/lib/auth-context';
import { createPlan, listPlansForClient, type Plan } from '../../../src/lib/plans';
import { createPlanSchema, type PlanType } from '../../../src/schemas/plan';
import { PLAN_STATUS_STYLE } from '../../../src/lib/plan-ui';

export default function ClientPlans() {
  const { role, session } = useAuth();
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<PlanType>('training');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setPlans(await listPlansForClient(id));
    } catch {
      /* leave existing list */
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

  async function onCreate() {
    setError(null);
    const parsed = createPlanSchema.safeParse({ client_id: id, type, title: title.trim() });
    if (!parsed.success) {
      setError('Enter a plan title.');
      return;
    }
    if (!session?.user?.id) {
      setError('Your session expired. Sign in again.');
      return;
    }
    setSubmitting(true);
    try {
      await createPlan(session.user.id, parsed.data);
      setTitle('');
      await load();
    } catch {
      setError('Could not create the plan. Please try again.');
    } finally {
      setSubmitting(false);
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
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={plans}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.listWrap}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.form}>
              <Text style={styles.client}>{name ?? 'Client'}</Text>

              <View style={styles.segment}>
                {(['training', 'nutrition'] as const).map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.segmentBtn, type === t && styles.segmentBtnActive]}
                    onPress={() => setType(t)}
                  >
                    <Text style={[styles.segmentText, type === t && styles.segmentTextActive]}>
                      {t === 'training' ? 'Training' : 'Nutrition'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="New plan title"
                editable={!submitting}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                style={[styles.button, submitting && styles.buttonDisabled]}
                onPress={onCreate}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Create plan</Text>
                )}
              </Pressable>

              <Text style={styles.sectionTitle}>Plans</Text>
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No plans yet.</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={styles.planRow}
              onPress={() => router.push({ pathname: '/coach/plan/[id]', params: { id: item.id } })}
            >
              <View style={styles.flex}>
                <Text style={styles.planTitle}>{item.title}</Text>
                <Text style={styles.planType}>{item.type}</Text>
              </View>
              <View style={[styles.status, PLAN_STATUS_STYLE[item.status]]}>
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  listWrap: { padding: 16, gap: 10 },
  form: { gap: 8, marginBottom: 6 },
  client: { fontSize: 22, fontWeight: '800', color: '#111', marginBottom: 4 },
  segment: { flexDirection: 'row', backgroundColor: '#eef0f3', borderRadius: 10, padding: 3 },
  segmentBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#6e7781' },
  segmentTextActive: { color: '#111' },
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginTop: 14 },
  empty: { fontSize: 14, color: '#888', paddingHorizontal: 4 },
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
});
