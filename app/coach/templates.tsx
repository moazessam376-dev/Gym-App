// Coach → plan templates. Templates are coach-owned plans with no client; the
// coach builds them once, then assigns deep copies to clients. This screen lists
// the coach's templates (filtered by type) and creates new ones.
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { listTemplates, type Plan } from '../../src/lib/plans';
import { type PlanType } from '../../src/schemas/plan';

export default function Templates() {
  const { role } = useAuth();
  const router = useRouter();
  const [type, setType] = useState<PlanType>('training');
  const [templates, setTemplates] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setTemplates(await listTemplates(type));
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

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={loading ? [] : templates}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.listWrap}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.form}>
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
              <Pressable
                style={styles.button}
                onPress={() => router.push({ pathname: '/coach/new-plan', params: { type } })}
              >
                <Text style={styles.buttonText}>＋ New plan (template or blank)</Text>
              </Pressable>
              <Text style={styles.sectionTitle}>Your {type} plans</Text>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 24 }} />
            ) : (
              <Text style={styles.empty}>No templates yet. Create your first above.</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/coach/plan/[id]', params: { id: item.id } })}
            >
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.chevron}>›</Text>
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
  listWrap: { padding: 16, gap: 10 },
  form: { gap: 8, marginBottom: 4 },
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
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600', textTransform: 'capitalize' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginTop: 14 },
  empty: { fontSize: 14, color: '#888', paddingHorizontal: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f5f6f8',
  },
  rowTitle: { flex: 1, fontSize: 16, color: '#111', fontWeight: '600' },
  chevron: { fontSize: 24, color: '#b0b7c0' },
});
