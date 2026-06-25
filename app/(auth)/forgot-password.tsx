// Forgot-password — request a reset email. Supabase sends a recovery link; opening
// it brings the user back into the app on a PASSWORD_RECOVERY session, where
// reset-password.tsx lets them set a new password. The redirect target is the app's
// own deep link (native: raptor://reset-password; web: /reset-password) — both must
// be added to the Supabase project's Auth → URL Configuration redirect allowlist.
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { createURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { emailSchema } from '../../src/schemas/auth';
import { Screen, Text, Input, Button } from '../../src/components/ui';
import { Wordmark } from '../../src/components/brand';
import { theme } from '../../src/theme';

export default function ForgotPassword() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit() {
    setError(null);
    const parsed = emailSchema.safeParse({ email: email.trim() });
    if (!parsed.success) {
      setError('Enter a valid email address.');
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
            <Text variant="h1">Reset your password</Text>
            <Text variant="body" muted>
              {sent
                ? 'If that email is registered, a reset link is on its way. Check your inbox.'
                : 'Enter your account email and we’ll send you a reset link.'}
            </Text>
          </View>

          {sent ? (
            <Button title="Back to sign in" onPress={() => router.replace('/(auth)/sign-in')} size="lg" />
          ) : (
            <>
              <Input
                label="Email"
                placeholder="you@example.com"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!loading}
                error={error}
              />
              <Button title="Send reset link" onPress={onSubmit} loading={loading} size="lg" style={{ marginTop: theme.spacing.sm }} />
              <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.sm }}>
                <Pressable onPress={() => router.replace('/(auth)/sign-in')}>
                  <Text variant="bodyStrong" color="link">
                    Back to sign in
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
