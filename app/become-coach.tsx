// Client → apply to become a coach. Shows the latest application's status if one
// exists; otherwise an optional message + Apply. Approval (and the role flip) is
// done by an admin via the Edge Function — never here.
import { useCallback, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { useAuth } from '../src/lib/auth-context';
import { applyToBecomeCoach, getMyApplication, type CoachApplication } from '../src/lib/coach-applications';
import { Screen, Text, Input, Button, GlassCard, Badge, type BadgeTone } from '../src/components/ui';
import { theme } from '../src/theme';

const STATUS_COPY: Record<CoachApplication['status'], { title: string; body: string; tone: BadgeTone }> = {
  pending: {
    title: 'Application pending',
    body: 'An admin will review your request. You’ll switch to a coach account once approved.',
    tone: 'warning',
  },
  approved: {
    title: 'Approved',
    body: 'You’re a coach now. Sign out and back in to load your coach tools.',
    tone: 'success',
  },
  rejected: {
    title: 'Not approved',
    body: 'Your application wasn’t approved this time. You can apply again below.',
    tone: 'danger',
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg }}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const blocking = application && application.status !== 'rejected';

  return (
    <Screen gradient padded={false} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.lg }}>
          {application ? (
            <GlassCard>
              <Badge label={STATUS_COPY[application.status].title} tone={STATUS_COPY[application.status].tone} />
              <Text variant="body" muted style={{ marginTop: theme.spacing.sm }}>
                {STATUS_COPY[application.status].body}
              </Text>
            </GlassCard>
          ) : null}

          {!blocking ? (
            <>
              <Text variant="body" muted>
                Coaches build training & nutrition plans and manage clients. Tell us a bit about your
                coaching background (optional).
              </Text>
              <Input
                value={message}
                onChangeText={setMessage}
                placeholder="e.g. 5 years personal training, nutrition certified…"
                multiline
                editable={!submitting}
                error={error}
                style={{ minHeight: 90, textAlignVertical: 'top' }}
              />
              <Button
                title={application?.status === 'rejected' ? 'Apply again' : 'Apply to become a coach'}
                onPress={onApply}
                loading={submitting}
                size="lg"
              />
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
