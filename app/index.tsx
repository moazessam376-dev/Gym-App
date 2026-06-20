import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/lib/auth-context';

// Signed-in landing. In Slice C this splits into role-specific homes
// ((client)/(coach)/(admin)); for now everyone lands here after login.
export default function Home() {
  const { session } = useAuth();

  async function onSignOut() {
    await supabase.auth.signOut();
    // onAuthStateChange clears the session → root guard routes back to sign-in.
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Gym-App</Text>
        <Text style={styles.subtitle}>You&apos;re signed in 🎉</Text>
        {session?.user?.email ? (
          <Text style={styles.email}>{session.user.email}</Text>
        ) : null}

        <Pressable style={styles.button} onPress={onSignOut}>
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  title: { fontSize: 30, fontWeight: '800', color: '#111' },
  subtitle: { fontSize: 16, color: '#444' },
  email: { fontSize: 15, color: '#1f6feb', marginBottom: 16 },
  button: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 28,
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
