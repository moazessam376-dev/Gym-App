import { useState } from 'react';
import { Link } from 'expo-router';
import { useAuth } from '../../src/lib/auth';
import { credentialsSchema } from '../../src/schemas/auth';
import { Button, ErrorText, Field, Hint, Screen, Title } from '../../src/components/ui';

export default function SignUp() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setMessage(null);
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setLoading(true);
    try {
      await signUp(parsed.data.email, parsed.data.password);
      setMessage('Account created. If email confirmation is on, check your inbox, then sign in.');
    } catch {
      setError('Could not sign up. Try a different email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <Title>Create account</Title>
      <Field
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Field
        placeholder="Password (min 8 chars)"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <ErrorText>{error}</ErrorText>
      {message ? <Hint>{message}</Hint> : null}
      <Button label="Sign up" onPress={onSubmit} loading={loading} />
      <Link href="/(auth)/sign-in" style={{ color: '#2563eb', textAlign: 'center' }}>
        Have an account? Sign in
      </Link>
    </Screen>
  );
}
