// Set-a-new-password screen, reached by opening the recovery link from the
// forgot-password email. Supabase establishes a temporary PASSWORD_RECOVERY session
// from the link (web: detectSessionInUrl in supabase.ts; native: the deep link +
// the auth state event), so updateUser({ password }) is authorized. After success
// we sign out so the user logs in fresh with the new password.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { passwordSchema } from '../../src/schemas/auth';
import { Screen, Text, Input, Button } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function ResetPassword() {
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
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const { error: authError } = await supabase.auth.updateUser({ password });
    if (authError) {
      setLoading(false);
      setError('Could not reset your password. Request a new link and try again.');
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
            Loading…
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen gradient padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.sm }}>
            <Text variant="h1">Set a new password</Text>
            <Text variant="body" muted>
              Choose a new password for your account.
            </Text>
          </View>

          <Input
            label="New password"
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
          />
          <Input
            label="Confirm password"
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            value={confirm}
            onChangeText={setConfirm}
            editable={!loading}
            error={error}
          />
          <Button title="Update password" onPress={onSubmit} loading={loading} size="lg" style={{ marginTop: theme.spacing.sm }} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
