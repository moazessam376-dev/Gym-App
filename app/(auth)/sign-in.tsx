import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { credentialsSchema } from '../../src/schemas/auth';
import { Screen, Text, Input, Button } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    const parsed = credentialsSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setError('Enter a valid email and a password of at least 8 characters.');
      return;
    }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (authError) {
      // Generic message — never echo provider/DB internals to the client (§4).
      setError('Invalid email or password.');
      return;
    }
    // Success: AuthProvider's onAuthStateChange flips the session and the root
    // guard routes us into the app.
  }

  return (
    <Screen gradient padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.lg }}>
          <View style={{ gap: theme.spacing.xs, marginBottom: theme.spacing.sm }}>
            <Text variant="h1">Welcome back</Text>
            <Text variant="body" muted>
              Sign in to your Gym-App account
            </Text>
          </View>

          <Input
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <Input
            label="Password"
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            error={error}
          />

          <Button title="Sign in" onPress={onSubmit} loading={loading} size="lg" style={{ marginTop: theme.spacing.sm }} />

          <Pressable onPress={() => router.push('/(auth)/forgot-password')} style={{ alignSelf: 'center' }}>
            <Text variant="body" color="link">
              Forgot password?
            </Text>
          </Pressable>

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.sm }}>
            <Text variant="body" muted>
              Don&apos;t have an account?{' '}
            </Text>
            <Pressable onPress={() => router.replace('/(auth)/sign-up')}>
              <Text variant="bodyStrong" color="link">
                Sign up
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
