// Client → apply to become a coach. Shows the latest application's status if one
// exists; otherwise an optional message + Apply. Approval (and the role flip) is
// done by an admin via the Edge Function — never here.
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
import { Redirect, useFocusEffect } from 'expo-router';
import { useAuth } from '../src/lib/auth-context';
import {
  applyToBecomeCoach,
  getMyApplication,
  type CoachApplication,
} from '../src/lib/coach-applications';

const STATUS_COPY: Record<CoachApplication['status'], { title: string; body: string; color: string }> = {
  pending: {
    title: 'Application pending',
    body: 'An admin will review your request. You’ll switch to a coach account once approved.',
    color: '#9a6700',
  },
  approved: {
    title: 'Approved 🎉',
    body: 'You’re a coach now. Sign out and back in to load your coach tools.',
    color: '#1a7f37',
  },
  rejected: {
    title: 'Not approved',
    body: 'Your application wasn’t approved this time. You can apply again below.',
    color: '#cf222e',
  },
};

export default function BecomeCoach() {
  const { role, session } = useAuth();
  const userId = session?.user?.id;

  const [application, setApplication] = useState<CoachApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setApplication(await getMyApplication(userId));
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

  // Only clients apply. A coach/admin who lands here goes home.
  if (role && role !== 'client') return <Redirect href="/" />;

  async function onApply() {
    setError(null);
    if (!userId) {
      setError('Your session expired. Sign in again.');
      return;
    }
    setSubmitting(true);
    try {
      await applyToBecomeCoach(userId, { message: message.trim() || undefined });
      setMessage('');
      await load();
    } catch {
      setError('Could not submit your application. Please try again.');
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

  // A live (pending/approved) application blocks re-applying; rejected can re-apply.
  const blocking = application && application.status !== 'rejected';

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          {application ? (
            <View style={[styles.statusCard, { borderColor: STATUS_COPY[application.status].color }]}>
              <Text style={[styles.statusTitle, { color: STATUS_COPY[application.status].color }]}>
                {STATUS_COPY[application.status].title}
              </Text>
              <Text style={styles.statusBody}>{STATUS_COPY[application.status].body}</Text>
            </View>
          ) : null}

          {!blocking ? (
            <>
              <Text style={styles.lead}>
                Coaches build training & nutrition plans and manage clients. Tell us a bit about
                your coaching background (optional).
              </Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={message}
                onChangeText={setMessage}
                placeholder="e.g. 5 years personal training, nutrition certified…"
                multiline
                editable={!submitting}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable
                style={[styles.button, submitting && styles.disabled]}
                onPress={onApply}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>
                    {application?.status === 'rejected' ? 'Apply again' : 'Apply to become a coach'}
                  </Text>
                )}
              </Pressable>
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  statusCard: { borderWidth: 1.5, borderRadius: 12, padding: 16, gap: 6 },
  statusTitle: { fontSize: 18, fontWeight: '800' },
  statusBody: { fontSize: 14, color: '#444' },
  lead: { fontSize: 15, color: '#57606a' },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  error: { color: '#cf222e', fontSize: 13 },
  button: { backgroundColor: '#1f6feb', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
