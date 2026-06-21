// Messages tab — conversation list. Coach: one row per client. Client: a single
// row for their coach. Tapping opens the thread (app/chat/[id]). The messages
// backend (migration 0012) is live, so this works end-to-end. There's no
// last-message/unread aggregation yet (deferred) — rows are the pairing only.
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { getMyCoach, listMyClients } from '../../src/lib/invitations';
import { Screen, Text, Avatar, GlassCard, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

type Conversation = { id: string; name: string };

export default function MessagesTab() {
  const { session, role } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;
  const [items, setItems] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      if (role === 'coach') {
        const clients = await listMyClients();
        setItems(clients.map((c) => ({ id: c.id, name: c.full_name ?? c.invited_email ?? 'Client' })));
      } else if (role === 'client' && userId) {
        const coach = await getMyCoach(userId);
        setItems(coach ? [{ id: coach.id, name: coach.full_name ?? 'Your coach' }] : []);
      } else {
        setItems([]);
      }
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [role, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <Screen padded={false} gradient>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Text variant="h1">Chat</Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.colors.primary} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="chatbubbles-outline"
              title={role === 'client' ? 'No coach yet' : 'No clients yet'}
              subtitle={
                role === 'client'
                  ? 'Once you accept a coach invite, you can message them here.'
                  : 'Invite clients to start chatting with them.'
              }
            />
          )
        }
        renderItem={({ item }) => (
          <GlassCard onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id, name: item.name } })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Avatar name={item.name} size={44} />
              <Text variant="title" style={{ flex: 1 }}>
                {item.name}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
            </View>
          </GlassCard>
        )}
      />
    </Screen>
  );
}
