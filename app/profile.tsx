// Edit your profile (display name). Any role. The name isn't in the JWT, so no
// re-login is needed — it reflects on the next data load (roster, coach card).
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../src/lib/auth-context';
import { getMyName, updateMyName } from '../src/lib/profile';

export default function Profile() {
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setName((await getMyName(userId)) ?? '');
    } catch {
      /* leave blank */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onSave() {
    setError(null);
    setSaved(false);
    if (name.trim().length < 1) {
      setError('Enter your name.');
      return;
    }
    if (!userId) {
      setError('Your session expired. Sign in again.');
      return;
    }
    setSaving(true);
    try {
      await updateMyName(userId, name);
      setSaved(true);
    } catch {
      setError('Could not save your name. Please try again.');
    } finally {
      setSaving(false);
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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          <Text style={styles.label}>Display name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={(t) => {
              setName(t);
              setSaved(false);
            }}
            placeholder="Your name"
            autoCapitalize="words"
            editable={!saving}
          />
          {session?.user?.email ? <Text style={styles.email}>{session.user.email}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {saved ? <Text style={styles.saved}>Saved ✓</Text> : null}

          <Pressable style={[styles.button, saving && styles.disabled]} onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save</Text>}
          </Pressable>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>Done</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 8 },
  label: { fontSize: 13, fontWeight: '700', color: '#444' },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  email: { fontSize: 14, color: '#6e7781', marginTop: 2 },
  error: { color: '#cf222e', fontSize: 13 },
  saved: { color: '#1a7f37', fontSize: 14, fontWeight: '600' },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  backBtn: { paddingVertical: 12, alignItems: 'center' },
  backText: { color: '#1f6feb', fontSize: 15, fontWeight: '600' },
});
