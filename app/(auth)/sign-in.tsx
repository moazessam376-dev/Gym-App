import { useState } from 'react';
import { Link } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { credentialsSchema } from '../../src/schemas/auth';
import { Button, ErrorText, Field, Screen, Title } from '../../src/components/ui';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setLoading(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
    } catch {
      // Generic message only — never surface raw auth/DB errors (§4).
      setError('Could not sign in. Check your email and password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>Sign in</Title>
      <Field
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Field placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <ErrorText>{error}</ErrorText>
      <Button label="Sign in" onPress={onSubmit} loading={loading} />
      <Link href="/(auth)/sign-up" style={{ color: '#2563eb', textAlign: 'center' }}>
        No account? Sign up
      </Link>
    </Screen>
  );
}
