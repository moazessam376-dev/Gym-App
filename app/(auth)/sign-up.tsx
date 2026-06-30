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

export default function SignUp() {
  const { t } = useTranslation();
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
      setError(t('auth.enterName'));
      return;
    }
    const parsed = credentialsSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      setError(t('auth.invalidCredentials'));
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
    // Generic outcome regardless of whether the email already exists (M-8: no account
    // enumeration). Pair this with Supabase Auth's "Prevent user enumeration" setting so
    // the server response is indistinguishable for new vs existing addresses.
    if (authError) {
      setError(t('auth.createFailed'));
      return;
    }
    if (!data.session) {
      setInfo(t('auth.confirmEmail'));
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
              {t('auth.createAccountTagline')}
            </Text>
          </View>

          <Input
            label={t('auth.fullName')}
            placeholder={t('auth.fullNamePlaceholder')}
            autoCapitalize="words"
            autoComplete="name"
            value={fullName}
            onChangeText={setFullName}
            editable={!loading}
          />
          <Input
            label={t('auth.email')}
            placeholder={t('auth.emailPlaceholder')}
            autoCapitalize="none"
            // See sign-in: QuickType height flicker shakes the centered form while typing.
            autoCorrect={false}
            spellCheck={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            editable={!loading}
          />
          <Input
            label={t('auth.password')}
            placeholder={t('auth.passwordMinPlaceholder')}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            value={password}
            onChangeText={setPassword}
            editable={!loading}
            error={error}
            returnKeyType="go"
            onSubmitEditing={onSubmit}
          />

          {info ? (
            <Text variant="caption" color="link">
              {info}
            </Text>
          ) : null}

          <Button title={t('auth.signUp')} onPress={onSubmit} loading={loading} size="lg" style={{ marginTop: theme.spacing.sm }} />

          <GoogleSignInButton onError={setError} disabled={loading} />

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: theme.spacing.sm }}>
            <Text variant="body" muted>
              {t('auth.haveAccount')}
            </Text>
            <Pressable
              onPress={() => router.replace('/(auth)/sign-in')}
              accessibilityRole="button"
              accessibilityLabel={t('auth.signIn')}
            >
              <Text variant="bodyStrong" color="link">
                {t('auth.signIn')}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
