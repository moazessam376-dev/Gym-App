// Messages tab — conversation list. Coach: one row per client. Client: a single
// row for their coach. Tapping opens the thread (app/chat/[id]). The messages
// backend (migration 0012) is live, so this works end-to-end. There's no
// last-message/unread aggregation yet (deferred) — rows are the pairing only.
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/lib/auth-context';
import { useMyClients, useMyCoach, useRefreshOnFocus } from '../../src/lib/queries/home';
import { Icon, Screen, Text, Avatar, GlassCard, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

type Conversation = { id: string; name: string };

export default function MessagesTab() {
  const { session, role } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  // Conversations derive from the SAME cached reads the rest of the app uses, so the
  // list is ready on first visit. The query for the wrong role just stays disabled.
  const clientsQ = useMyClients();
  const coachQ = useMyCoach(role === 'client' ? userId : undefined);
  useRefreshOnFocus(role === 'coach' ? clientsQ.refetch : coachQ.refetch);

  const items: Conversation[] =
    role === 'coach'
      ? (clientsQ.data ?? []).map((c) => ({ id: c.id, name: c.full_name ?? c.invited_email ?? 'Client' }))
      : role === 'client' && coachQ.data
        ? [{ id: coachQ.data.id, name: coachQ.data.full_name ?? 'Your coach' }]
        : [];
  const loading = role === 'coach' ? clientsQ.isPending : coachQ.isPending;
  const load = () => (role === 'coach' ? clientsQ.refetch() : coachQ.refetch());

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
              <Icon name="chevron-forward" size={20} color={theme.colors.textMuted} />
            </View>
          </GlassCard>
        )}
      />
    </Screen>
  );
}
