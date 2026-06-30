// Set-a-new-password screen, reached by opening the recovery link from the
// forgot-password email. Supabase establishes a temporary PASSWORD_RECOVERY session
// from the link (web: detectSessionInUrl in supabase.ts; native: the deep link +
// the auth state event), so updateUser({ password }) is authorized. After success
// we sign out so the user logs in fresh with the new password.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { passwordSchema } from '../../src/schemas/auth';
import { Screen, Text, Input, Button } from '../../src/components/ui';
import { Wordmark } from '../../src/components/brand';
import { theme } from '../../src/theme';

export default function ResetPassword() {
  const { t } = useTranslation();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // Confirm we actually arrived via a recovery link (a session exists). If not,
  // there's nothing to reset — send them to sign-in.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) setReady(true);
      else router.replace('/(auth)/sign-in');
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function onSubmit() {
    setError(null);
    const parsed = passwordSchema.safeParse({ password });
    if (!parsed.success) {
      setError(t('auth.passwordMin'));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.passwordsNoMatch'));
      return;
    }
    setLoading(true);
    const { error: authError } = await supabase.auth.updateUser({ password });
    if (authError) {
      setLoading(false);
      setError(t('auth.resetFailed'));
      return;
    }
    // Sign out so the new password is used on the next sign-in (clean state).
    await supabase.auth.signOut();
    setLoading(false);
    router.replace('/(auth)/sign-in');
  }

  if (!ready) {
    return (
      <Screen gradient>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Text variant="body" muted style={{ textAlign: 'center' }}>
            {t('common.loading')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen gradient padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.lg }}>
          <Wordmark size={30} style={{ alignSelf: 'center', marginBottom: theme.spacing.sm }} />
          <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.sm }}>
            <Text variant="h1">{t('auth.setNewPasswordTitle')}</Text>
            <Text variant="body" muted>
              {t('auth.setNewPasswordPrompt')}
            </Text>
          </View>

          <Input
            label={t('auth.newPassword')}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
          />
          <Input
            label={t('auth.confirmPassword')}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            value={confirm}
            onChangeText={setConfirm}
            editable={!loading}
            error={error}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />
          <Button title={t('auth.updatePassword')} onPress={onSubmit} loading={loading} size="lg" style={{ marginTop: theme.spacing.sm }} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
