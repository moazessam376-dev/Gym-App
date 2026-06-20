// Coach invite — create a single-use invitation and share its token.
//
// Creating the row is a client-side insert (allowed by the invitations RLS
// INSERT policy: a coach creates their OWN pending invite). The token is shown
// for the coach to share; the invitee redeems it on the accept-invite screen,
// which routes through the Edge Function that actually assigns coach_id (§2).
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
import { Redirect, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { createInvitationSchema } from '../../src/schemas/invitation';
import {
  createInvitation,
  listMyInvitations,
  DUPLICATE_PENDING_INVITE,
  type Invitation,
} from '../../src/lib/invitations';

export default function Invite() {
  const { role, session } = useAuth();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [lastToken, setLastToken] = useState<string | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  const load = useCallback(async () => {
    try {
      setInvitations(await listMyInvitations());
    } catch {
      /* non-fatal: the list just stays as-is */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (role && role !== 'coach') return <Redirect href="/" />;

  async function onSubmit() {
    setFieldError(null);
    setFormError(null);
    setLastToken(null);

    const parsed = createInvitationSchema.safeParse({ email: email.trim() });
    if (!parsed.success) {
      setFieldError('Enter a valid email address.');
      return;
    }
    if (!session?.user?.id) {
      setFormError('Your session expired. Sign in again.');
      return;
    }

    setSubmitting(true);
    try {
      const inv = await createInvitation(session.user.id, parsed.data);
      setLastToken(inv.token);
      setEmail('');
      await load();
    } catch (e) {
      if (e instanceof Error && e.message === DUPLICATE_PENDING_INVITE) {
        setFormError('You already have a pending invite for this email.');
      } else {
        // Generic message — never surface raw DB errors (§4).
        setFormError('Could not create the invitation. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          data={invitations}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.listWrap}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={styles.form}>
              <Text style={styles.label}>Client email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="client@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!submitting}
              />
              {fieldError ? <Text style={styles.error}>{fieldError}</Text> : null}

              <Pressable
                style={[styles.button, submitting && styles.buttonDisabled]}
                onPress={onSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Create invitation</Text>
                )}
              </Pressable>
              {formError ? <Text style={styles.error}>{formError}</Text> : null}

              {lastToken ? (
                <View style={styles.tokenCard}>
                  <Text style={styles.tokenLabel}>Share this token with your client</Text>
                  <Text style={styles.token} selectable>
                    {lastToken}
                  </Text>
                  <Text style={styles.tokenHint}>
                    They enter it on “Accept an invite”. It’s single-use and expires in 7 days.
                  </Text>
                </View>
              ) : null}

              <Text style={styles.sectionTitle}>Your invitations</Text>
            </View>
          }
          ListEmptyComponent={<Text style={styles.empty}>No invitations yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.invRow}>
              <View style={styles.flex}>
                <Text style={styles.invEmail}>{item.email}</Text>
                <Text style={styles.invMeta}>
                  expires {new Date(item.expires_at).toLocaleDateString()}
                </Text>
              </View>
              <View style={[styles.status, STATUS_STYLE[item.status]]}>
                <Text style={styles.statusText}>{item.status}</Text>
              </View>
            </View>
          )}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const STATUS_STYLE: Record<Invitation['status'], { backgroundColor: string }> = {
  pending: { backgroundColor: '#9a6700' },
  accepted: { backgroundColor: '#1a7f37' },
  revoked: { backgroundColor: '#cf222e' },
  expired: { backgroundColor: '#6e7781' },
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  listWrap: { padding: 16, gap: 10 },
  form: { gap: 8, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', color: '#444' },
  input: {
    borderWidth: 1,
    borderColor: '#d0d7de',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111',
  },
  button: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#cf222e', fontSize: 13 },
  tokenCard: {
    backgroundColor: '#eef6ff',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    marginTop: 6,
  },
  tokenLabel: { fontSize: 13, fontWeight: '700', color: '#1f6feb' },
  token: { fontSize: 15, color: '#111', fontWeight: '600', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  tokenHint: { fontSize: 12, color: '#57606a' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginTop: 14 },
  empty: { fontSize: 14, color: '#888', paddingHorizontal: 4 },
  invRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f5f6f8',
  },
  invEmail: { fontSize: 15, color: '#111', fontWeight: '600' },
  invMeta: { fontSize: 12, color: '#6e7781', marginTop: 2 },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
