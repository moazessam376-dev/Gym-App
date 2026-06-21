// Coach → start a new plan. Two paths: clone a ready-made SYSTEM TEMPLATE (the
// fast path — pre-filled weeks/days/exercises + example comments, then fully
// editable), or start blank. Either way the coach lands in the plan editor with a
// coach-owned, editable template they can later assign to a client.
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
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import {
  cloneTemplate,
  createTemplate,
  createWeek,
  listSystemTemplates,
  type Plan,
} from '../../src/lib/plans';
import { planTypeSchema, type PlanType } from '../../src/schemas/plan';

export default function NewPlan() {
  const { role, session } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ type?: string }>();
  const initial = planTypeSchema.safeParse(params.type).success ? (params.type as PlanType) : 'training';

  const [type, setType] = useState<PlanType>(initial);
  const [title, setTitle] = useState('');
  const [templates, setTemplates] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await listSystemTemplates(type));
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [type]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function startBlank() {
    if (!session?.user?.id || busy) return;
    setBusy(true);
    try {
      const t = title.trim() || (type === 'training' ? 'New training plan' : 'New nutrition plan');
      const created = await createTemplate(session.user.id, { type, title: t });
      // A training plan needs a week to hold days; seed Week 1 up front.
      if (type === 'training') await createWeek({ plan_id: created.id, name: 'Week 1', position: 0 });
      router.replace({ pathname: '/coach/plan/[id]', params: { id: created.id } });
    } catch {
      Alert.alert('Error', 'Could not create the plan. Please try again.');
      setBusy(false);
    }
  }

  async function startFromTemplate(t: Plan) {
    if (busy) return;
    setBusy(true);
    try {
      const newId = await cloneTemplate(t.id);
      router.replace({ pathname: '/coach/plan/[id]', params: { id: newId } });
    } catch {
      Alert.alert('Error', 'Could not start from that template. Please try again.');
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={loading ? [] : templates}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.wrap}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.head}>
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

              <Text style={styles.sectionTitle}>Start blank</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder={type === 'training' ? 'Plan name (e.g. PPL Hypertrophy)' : 'Plan name (e.g. Lean Cut)'}
                editable={!busy}
              />
              <Pressable style={[styles.blankBtn, busy && styles.disabled]} onPress={startBlank} disabled={busy}>
                <Text style={styles.blankBtnText}>Start blank {type} plan</Text>
              </Pressable>

              <Text style={styles.sectionTitle}>Or start from a template</Text>
              {loading ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
            </View>
          }
          ListEmptyComponent={
            loading ? null : (
              <Text style={styles.empty}>
                No {type} templates yet — start blank above.
              </Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable style={styles.tpl} onPress={() => startFromTemplate(item)} disabled={busy}>
              <View style={styles.flex}>
                <Text style={styles.tplTitle}>{item.title}</Text>
                {item.note ? (
                  <Text style={styles.tplNote} numberOfLines={2}>
                    {item.note}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.use}>Use ›</Text>
            </Pressable>
          )}
        />
        {busy ? (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color="#fff" />
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  wrap: { padding: 16, gap: 10 },
  head: { gap: 10 },
  segment: { flexDirection: 'row', backgroundColor: '#eef0f3', borderRadius: 10, padding: 3 },
  segmentBtn: { flex: 1, paddingVertical: 9, borderRadius: 8, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#6e7781' },
  segmentTextActive: { color: '#111' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  blankBtn: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  blankBtnText: { color: '#fff', fontSize: 15, fontWeight: '600', textTransform: 'capitalize' },
  disabled: { opacity: 0.6 },
  empty: { fontSize: 14, color: '#888', paddingHorizontal: 4, marginTop: 8 },
  tpl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f5f6f8',
  },
  tplTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  tplNote: { fontSize: 13, color: '#6e7781', marginTop: 2 },
  use: { fontSize: 14, fontWeight: '700', color: '#1f6feb' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
