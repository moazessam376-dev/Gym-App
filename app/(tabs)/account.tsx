// Account hub tab — identity + role-specific actions + sign out. Replaces the
// account bits of the old launcher home (edit profile, become-coach, invite).
import { useCallback, useState } from 'react';
import { View, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/lib/auth-context';
import { getMyName } from '../../src/lib/profile';
import { getMyCoach } from '../../src/lib/invitations';
import { Screen, Text, Card, Avatar, Badge, Button } from '../../src/components/ui';
import { theme } from '../../src/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function LinkRow({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={theme.colors.primary} />
      <Text variant="bodyStrong" style={{ flex: 1 }}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}

export default function AccountTab() {
  const { session, role } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;
  const [name, setName] = useState<string | null>(null);
  const [hasCoach, setHasCoach] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setName(await getMyName(userId));
      if (role === 'client') setHasCoach((await getMyCoach(userId)) != null);
    } catch {
      /* best-effort */
    }
  }, [userId, role]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const go = (href: Href) => () => router.push(href);

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.lg }}>
      <Text variant="h1">Account</Text>

      <Card style={{ alignItems: 'center', gap: theme.spacing.sm, paddingVertical: theme.spacing.xl }}>
        <Avatar name={name ?? session?.user?.email ?? '?'} size={84} />
        <Text variant="h2">{name ?? 'Set your name'}</Text>
        {session?.user?.email ? (
          <Text variant="caption" muted>
            {session.user.email}
          </Text>
        ) : null}
        {role ? <Badge label={role} tone="secondary" solid /> : null}
      </Card>

      <View style={{ gap: theme.spacing.sm }}>
        <LinkRow icon="person-outline" label="Edit profile" onPress={go('/profile')} />

        {role === 'client' ? (
          <>
            {!hasCoach ? (
              <LinkRow icon="ticket-outline" label="Accept an invite" onPress={go('/accept-invite')} />
            ) : null}
            <LinkRow icon="ribbon-outline" label="Become a coach" onPress={go('/become-coach')} />
          </>
        ) : null}

        {role === 'coach' ? (
          <>
            <LinkRow icon="person-add-outline" label="Invite a client" onPress={go('/coach/invite')} />
            <LinkRow icon="documents-outline" label="Plan templates" onPress={go('/coach/templates')} />
          </>
        ) : null}

        {role === 'admin' ? (
          <LinkRow
            icon="clipboard-outline"
            label="Coach applications"
            onPress={go('/admin/applications')}
          />
        ) : null}
      </View>

      <Button
        title="Sign out"
        variant="ghost"
        onPress={() => supabase.auth.signOut()}
        style={{ marginTop: theme.spacing.md }}
      />
    </Screen>
  );
}
