import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../src/lib/supabase';

// Reached only if a signed-in user's token has no role (rare — every signup is
// bootstrapped as 'client'). A safe holding screen; signing out re-mints a token.
export default function Onboarding() {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <Text style={styles.title}>Finishing setup…</Text>
        <Text style={styles.note}>
          We&apos;re getting your account ready. If this doesn&apos;t move along in a
          moment, sign out and back in.
        </Text>
        <Pressable style={styles.button} onPress={() => supabase.auth.signOut()}>
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#111' },
  note: { fontSize: 15, color: '#666', textAlign: 'center' },
  button: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 28,
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
