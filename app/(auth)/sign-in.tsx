import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../src/lib/supabase';
import { credentialsSchema } from '../../src/schemas/auth';
import { Screen, Text, Input, Button } from '../../src/components/ui';
import { GoogleSignInButton } from '../../src/components/GoogleSignInButton';
import { Wordmark } from '../../src/components/brand';
import { theme } from '../../src/theme';

export default function SignIn() {
  const { t } = useTranslation();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    const parsed = credentialsSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setError(t('auth.invalidCredentials'));
      return;
    }
    setLoading(true);
    const { error: authError } = await supabase.auth.signInWithPassword(parsed.data);
    setLoading(false);
    if (authError) {
      // Generic message — never echo provider/DB internals to the client (§4).
      setError(t('auth.invalidEmailPassword'));
      return;
    }
    // Success: AuthProvider's onAuthStateChange flips the session and the root
    // guard routes us into the app.
  }

  return (
    <Screen gradient padded={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flex: 1, justifyContent: 'center', padding: theme.spacing.xl, gap: theme.spacing.lg }}>
          <View style={{ alignItems: 'center', gap: theme.spacing.xs, marginBottom: theme.spacing.md }}>
            <Wordmark size={44} />
            <Text variant="label" muted style={{ letterSpacing: 2 }}>
              {t('auth.tagline')}
            </Text>
          </View>

          <Input
            label={t('auth.email')}
            placeholder={t('auth.emailPlaceholder')}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <Input
            label={t('auth.password')}
            placeholder="••••••••"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            error={error}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />

          <Button title={t('auth.signIn')} onPress={onSubmit} loading={loading} size="lg" style={{ marginTop: theme.spacing.sm }} />

          <GoogleSignInButton onError={setError} disabled={loading} />

          <Pressable
            onPress={() => router.push('/(auth)/forgot-password')}
            style={{ alignSelf: 'center' }}
            accessibilityRole="button"
            accessibilityLabel={t('auth.forgotPassword')}
          >
            <Text variant="body" color="link">
              {t('auth.forgotPassword')}
            </Text>
          </Pressable>

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.sm }}>
            <Text variant="body" muted>
              {t('auth.noAccount')}
            </Text>
            <Pressable
              onPress={() => router.replace('/(auth)/sign-up')}
              accessibilityRole="button"
              accessibilityLabel={t('auth.signUp')}
            >
              <Text variant="bodyStrong" color="link">
                {t('auth.signUp')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
