// Coach invite — create a single-use invitation and share its token.
// Creating the row is a client-side insert (allowed by the invitations RLS INSERT
// policy). The invitee redeems the token on accept-invite (Edge Function assigns
// coach_id, §2).
import { useCallback, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { createInvitationSchema } from '../../src/schemas/invitation';
import { createInvitation, listMyInvitations, DUPLICATE_PENDING_INVITE, type Invitation } from '../../src/lib/invitations';
import { Screen, Text, Input, Button, Card, GlassCard, Badge, type BadgeTone } from '../../src/components/ui';
import { theme } from '../../src/theme';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const STATUS_TONE: Record<Invitation['status'], BadgeTone> = {
  pending: 'warning',
  accepted: 'success',
  revoked: 'danger',
  expired: 'neutral',
};

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
      /* non-fatal */
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
        setFormError('Could not create the invitation. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={invitations}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
              <Input
                label="Client email"
                value={email}
                onChangeText={setEmail}
                placeholder="client@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                editable={!submitting}
                error={fieldError ?? formError}
              />
              <Button title="Create invitation" onPress={onSubmit} loading={submitting} size="lg" />

              {lastToken ? (
                <GlassCard glowColor={theme.colors.primary}>
                  <Text variant="label" color="primary">
                    Share this token with your client
                  </Text>
                  <Text selectable style={{ fontFamily: MONO, fontSize: 15, color: theme.colors.text, marginTop: theme.spacing.sm }}>
                    {lastToken}
                  </Text>
                  <Text variant="caption" muted style={{ marginTop: theme.spacing.sm }}>
                    They enter it on “Accept an invite”. Single-use, expires in 7 days.
                  </Text>
                </GlassCard>
              ) : null}

              <Text variant="label" muted style={{ marginTop: theme.spacing.sm }}>
                Your invitations
              </Text>
            </View>
          }
          ListEmptyComponent={
            <Text variant="body" muted>
              No invitations yet.
            </Text>
          }
          renderItem={({ item }) => (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{item.email}</Text>
                  <Text variant="caption" muted>
                    expires {new Date(item.expires_at).toLocaleDateString()}
                  </Text>
                </View>
                <Badge label={item.status} tone={STATUS_TONE[item.status]} />
              </View>
            </Card>
          )}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
