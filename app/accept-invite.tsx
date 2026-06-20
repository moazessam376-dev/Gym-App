// Accept an invite — the client pastes the token their coach shared.
//
// The redemption goes through the accept-invitation Edge Function (the only
// writer of coach_id / invitation status, §2). supabase-js attaches the user's
// bearer token automatically, so the server resolves the accepting user + email
// from the verified JWT — the token is the only thing we send. Errors are
// generic on purpose (the server collapses every failure to one opaque message).
import { useState } from 'react';
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
import { useRouter } from 'expo-router';
import { acceptInvitationSchema } from '../src/schemas/invitation';
import { acceptInvitation } from '../src/lib/invitations';

export default function AcceptInvite() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit() {
    setError(null);
    const parsed = acceptInvitationSchema.safeParse({ token: token.trim() });
    if (!parsed.success) {
      setError('That doesn’t look like a valid invite token.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await acceptInvitation(parsed.data);
      if (result.ok) {
        setDone(true);
      } else if (result.reason === 'already_has_coach') {
        setError('You already have a coach. You can only be linked to one at a time.');
      } else {
        setError(
          'This invite couldn’t be accepted. It may be used, expired, or for a different email.',
        );
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <View style={styles.center}>
          <View style={styles.check}>
            <Text style={styles.checkMark}>✓</Text>
          </View>
          <Text style={styles.title}>You’re connected!</Text>
          <Text style={styles.note}>Your coach can now see you on their roster.</Text>
          <Pressable style={styles.button} onPress={() => router.replace('/')}>
            <Text style={styles.buttonText}>Go to home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>
          <Text style={styles.title}>Accept an invite</Text>
          <Text style={styles.note}>Paste the token your coach shared with you.</Text>

          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!submitting}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, submitting && styles.buttonDisabled]}
            onPress={onSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Accept invite</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  title: { fontSize: 24, fontWeight: '800', color: '#111' },
  note: { fontSize: 15, color: '#666', marginBottom: 8, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111',
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  error: { color: '#cf222e', fontSize: 13 },
  button: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
    paddingHorizontal: 28,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  check: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#1a7f37',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  checkMark: { color: '#fff', fontSize: 34, fontWeight: '800' },
});
