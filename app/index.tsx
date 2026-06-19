import { Text } from 'react-native';
import { useAuth } from '../src/lib/auth';
import { Button, Hint, Screen, Title } from '../src/components/ui';

// Protected home. The root guard redirects unauthenticated users to sign-in.
// Role-specific areas (coach / client / admin) arrive in Phase 2.
export default function Home() {
  const { session, role, fullName, signOut } = useAuth();
  return (
    <Screen>
      <Title>Welcome{fullName ? `, ${fullName}` : ''} 👋</Title>
      <Hint>Signed in as {session?.user.email ?? 'unknown'}</Hint>
      <Text style={{ fontSize: 16 }}>Your role: {role ?? 'loading…'}</Text>
      <Button label="Sign out" onPress={signOut} />
    </Screen>
  );
}
