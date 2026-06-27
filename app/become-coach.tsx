// Client → apply to become a coach. Shows the latest application's status if one
// exists; otherwise an optional message + Apply. Approval (and the role flip) is
// done by an admin via the Edge Function — never here.
import { useCallback, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from 'react-native';
import { Redirect, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../src/lib/auth-context';
import { applyToBecomeCoach, getMyApplication, type CoachApplication } from '../src/lib/coach-applications';
import { Screen, Text, Input, Button, GlassCard, Badge, type BadgeTone } from '../src/components/ui';
import { theme } from '../src/theme';

// Tone is presentation-only (not translated); the title/body come from the
// becomeCoach.<status>Title / <status>Body keys, resolved with t() in render.
const STATUS_TONE: Record<CoachApplication['status'], BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

export default function BecomeCoach() {
  const { t } = useTranslation();
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
      setError(t('becomeCoach.sessionExpired'));
      return;
    }
    setSubmitting(true);
    try {
      await applyToBecomeCoach(userId, { message: message.trim() || undefined });
      setMessage('');
      await load();
    } catch {
      setError(t('becomeCoach.submitError'));
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
              <Badge label={t(`becomeCoach.${application.status}Title`)} tone={STATUS_TONE[application.status]} />
              <Text variant="body" muted style={{ marginTop: theme.spacing.sm }}>
                {t(`becomeCoach.${application.status}Body`)}
              </Text>
            </GlassCard>
          ) : null}

          {!blocking ? (
            <>
              <Text variant="body" muted>
                {t('becomeCoach.intro')}
              </Text>
              <Input
                value={message}
                onChangeText={setMessage}
                placeholder={t('becomeCoach.messagePlaceholder')}
                multiline
                editable={!submitting}
                error={error}
                style={{ minHeight: 90, textAlignVertical: 'top' }}
              />
              <Button
                title={application?.status === 'rejected' ? t('becomeCoach.applyAgain') : t('becomeCoach.apply')}
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
