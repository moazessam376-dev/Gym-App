import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { credentialsSchema } from '../../src/schemas/auth';
import { Screen, Text, Input, Button } from '../../src/components/ui';
import { GoogleSignInButton } from '../../src/components/GoogleSignInButton';
import { Wordmark } from '../../src/components/brand';
import { theme } from '../../src/theme';

export default function SignUp() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setInfo(null);
    const name = fullName.trim();
    if (name.length < 2) {
      setError('Enter your name.');
      return;
    }
    const parsed = credentialsSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setError('Enter a valid email and a password of at least 8 characters.');
      return;
    }
    setLoading(true);
    // full_name rides along in user metadata; the profile bootstrap trigger
    // (0008) reads it server-side at signup.
    const { data, error: authError } = await supabase.auth.signUp({
      ...parsed.data,
      options: { data: { full_name: name } },
    });
    setLoading(false);
    if (authError) {
      const msg = authError.message?.toLowerCase() ?? '';
      if (msg.includes('already') || msg.includes('registered')) {
        setError('An account with this email already exists. Try signing in.');
      } else {
        setError('Could not create your account. Please try again.');
      }
      return;
    }
    if (!data.session) {
      setInfo('Account created. Check your email to confirm, then sign in.');
      return;
    }
  }

  return (
    <Screen gradient padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.lg }}>
          <View style={{ alignItems: 'center', gap: theme.spacing.xs, marginBottom: theme.spacing.md }}>
            <Wordmark size={44} />
            <Text variant="label" muted style={{ letterSpacing: 2 }}>
              Create your account
            </Text>
          </View>

          <Input
            label="Full name"
            placeholder="Your name"
            autoCapitalize="words"
            autoComplete="name"
            value={fullName}
            onChangeText={setFullName}
            editable={!loading}
          />
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
            placeholder="Min 8 characters"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            error={error}
          />

          {info ? (
            <Text variant="caption" color="link">
              {info}
            </Text>
          ) : null}

          <Button title="Sign up" onPress={onSubmit} loading={loading} size="lg" style={{ marginTop: theme.spacing.sm }} />

          <GoogleSignInButton onError={setError} disabled={loading} />

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.sm }}>
            <Text variant="body" muted>
              Already have an account?{' '}
            </Text>
            <Pressable onPress={() => router.replace('/(auth)/sign-in')}>
              <Text variant="bodyStrong" color="link">
                Sign in
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
