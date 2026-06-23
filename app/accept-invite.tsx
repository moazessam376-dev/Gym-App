// Accept an invite — the client pastes the token their coach shared.
//
// The redemption goes through the accept-invitation Edge Function (the only
// writer of coach_id / invitation status, §2). supabase-js attaches the user's
// bearer token automatically, so the server resolves the accepting user + email
// from the verified JWT. Errors are generic on purpose.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { acceptInvitationSchema } from '../src/schemas/invitation';
import { acceptInvitation } from '../src/lib/invitations';
import { Screen, Text, Input, Button } from '../src/components/ui';
import { theme } from '../src/theme';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

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
        setError('This invite couldn’t be accepted. It may be used, expired, or for a different email.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Screen gradient edges={['bottom']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md, padding: theme.spacing.xl }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: theme.colors.success,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="checkmark" size={40} color={theme.colors.bg} />
          </View>
          <Text variant="h1" align="center">
            You’re connected!
          </Text>
          <Text variant="body" muted align="center">
            Your coach can now see you on their roster.
          </Text>
          <Button title="Go to home" onPress={() => router.replace('/(tabs)')} style={{ marginTop: theme.spacing.lg, alignSelf: 'stretch' }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.md }}>
          <Text variant="h1">Accept an invite</Text>
          <Text variant="body" muted>
            Paste the token your coach shared with you.
          </Text>
          <Input
            value={token}
            onChangeText={setToken}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!submitting}
            error={error}
            style={{ fontFamily: MONO, fontSize: 14 }}
          />
          <Button title="Accept invite" onPress={onSubmit} loading={submitting} size="lg" style={{ marginTop: theme.spacing.xs }} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
