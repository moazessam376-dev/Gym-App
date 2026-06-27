// Forgot-password — request a reset email. Supabase sends a recovery link; opening
// it brings the user back into the app on a PASSWORD_RECOVERY session, where
// reset-password.tsx lets them set a new password. The redirect target is the app's
// own deep link (native: raptor://reset-password; web: /reset-password) — both must
// be added to the Supabase project's Auth → URL Configuration redirect allowlist.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { createURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { emailSchema } from '../../src/schemas/auth';
import { Screen, Text, Input, Button } from '../../src/components/ui';
import { Wordmark } from '../../src/components/brand';
import { theme } from '../../src/theme';

export default function ForgotPassword() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit() {
    setError(null);
    const parsed = emailSchema.safeParse({ email: email.trim() });
    if (!parsed.success) {
      setError(t('auth.invalidEmail'));
      return;
    }
    setLoading(true);
    // Deep link back into the app to complete the reset. createURL builds the right
    // URI per platform (raptor://reset-password on native, <origin>/reset-password on web).
    const redirectTo = createURL('/reset-password');
    const { error: authError } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo,
    });
    setLoading(false);
    // Always show success — never reveal whether an email is registered (avoids
    // account enumeration; §4 generic messaging).
    if (authError) console.warn('resetPasswordForEmail failed');
    setSent(true);
  }

  return (
    <Screen gradient padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.lg }}>
          <Wordmark size={30} style={{ alignSelf: 'center', marginBottom: theme.spacing.sm }} />
          <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.sm }}>
            <Text variant="h1">{t('auth.resetTitle')}</Text>
            <Text variant="body" muted>
              {sent ? t('auth.resetSent') : t('auth.resetPrompt')}
            </Text>
          </View>

          {sent ? (
            <Button title={t('auth.backToSignIn')} onPress={() => router.replace('/(auth)/sign-in')} size="lg" />
          ) : (
            <>
              <Input
                label={t('auth.email')}
                placeholder={t('auth.emailPlaceholder')}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!loading}
                error={error}
              />
              <Button title={t('auth.sendResetLink')} onPress={onSubmit} loading={loading} size="lg" style={{ marginTop: theme.spacing.sm }} />
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.sm }}>
                <Pressable
                  onPress={() => router.replace('/(auth)/sign-in')}
                  accessibilityRole="button"
                  accessibilityLabel={t('auth.backToSignIn')}
                >
                  <Text variant="bodyStrong" color="link">
                    {t('auth.backToSignIn')}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
