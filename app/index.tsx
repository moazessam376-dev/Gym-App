import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../src/lib/supabase';
import { useAuth } from '../src/lib/auth-context';
import { getMyCoach, type Coach } from '../src/lib/invitations';

// The role-gated landing. Content is driven by the role from the verified JWT.
// As each role grows features, these become full navigation trees (Phase 2+).
const ROLE_COPY = {
  client: { tag: 'CLIENT', title: 'Your training home' },
  coach: { tag: 'COACH', title: 'Coach dashboard' },
  admin: { tag: 'ADMIN', title: 'Admin console' },
} as const;

export default function Home() {
  const { session, role } = useAuth();
  const router = useRouter();
  const copy = role ? ROLE_COPY[role] : { tag: '—', title: 'Gym-App' };
  const [coach, setCoach] = useState<Coach | null>(null);

  // Clients: load their assigned coach (readable via the 0008 own-coach policy).
  // Refreshes on focus so it reflects a just-accepted invite.
  const userId = session?.user?.id;
  useFocusEffect(
    useCallback(() => {
      let active = true;
      if (role === 'client' && userId) {
        getMyCoach(userId)
          .then((c) => active && setCoach(c))
          .catch(() => active && setCoach(null));
      }
      return () => {
        active = false;
      };
    }, [role, userId]),
  );

  async function onSignOut() {
    await supabase.auth.signOut();
    // onAuthStateChange clears the session → root guard routes back to sign-in.
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{copy.tag}</Text>
        </View>
        <Text style={styles.title}>{copy.title}</Text>
        {session?.user?.email ? <Text style={styles.email}>{session.user.email}</Text> : null}
        <Text style={styles.note}>Role read from your signed token, enforced by RLS.</Text>

        {role === 'coach' ? (
          <View style={styles.actions}>
            <Pressable style={styles.action} onPress={() => router.push('/coach/roster')}>
              <Text style={styles.actionText}>My clients</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => router.push('/coach/templates')}>
              <Text style={styles.actionText}>Plan templates</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => router.push('/coach/invite')}>
              <Text style={styles.actionText}>Invite a client</Text>
            </Pressable>
          </View>
        ) : null}

        {role === 'client' ? (
          <View style={styles.actions}>
            {coach ? (
              <View style={styles.coachCard}>
                <Text style={styles.coachLabel}>YOUR COACH</Text>
                <Text style={styles.coachName}>{coach.full_name ?? 'Your coach'}</Text>
              </View>
            ) : (
              <Pressable style={styles.action} onPress={() => router.push('/accept-invite')}>
                <Text style={styles.actionText}>Accept an invite</Text>
              </Pressable>
            )}
            <Pressable style={styles.action} onPress={() => router.push('/client/plans')}>
              <Text style={styles.actionText}>My plans</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => router.push('/become-coach')}>
              <Text style={styles.actionText}>Become a coach</Text>
            </Pressable>
          </View>
        ) : null}

        {role === 'admin' ? (
          <View style={styles.actions}>
            <Pressable style={styles.action} onPress={() => router.push('/admin/applications')}>
              <Text style={styles.actionText}>Coach applications</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable style={styles.linkBtn} onPress={() => router.push('/profile')}>
          <Text style={styles.linkText}>Edit profile</Text>
        </Pressable>

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
  badge: {
    backgroundColor: '#1f6feb',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
    marginBottom: 4,
  },
  badgeText: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 1 },
  title: { fontSize: 28, fontWeight: '800', color: '#111' },
  email: { fontSize: 15, color: '#1f6feb' },
  note: { fontSize: 13, color: '#888', textAlign: 'center', marginTop: 4, marginBottom: 16 },
  actions: { alignSelf: 'stretch', gap: 10, marginBottom: 8 },
  action: {
    backgroundColor: '#1f6feb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  actionText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkBtn: { paddingVertical: 8 },
  linkText: { color: '#1f6feb', fontSize: 15, fontWeight: '600' },
  coachCard: {
    backgroundColor: '#eef6ff',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 2,
  },
  coachLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: '#1f6feb' },
  coachName: { fontSize: 18, fontWeight: '700', color: '#111' },
  button: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingVertical: 13,
    paddingHorizontal: 28,
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
