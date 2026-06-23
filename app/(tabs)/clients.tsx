// Coach → clients tab. RLS (is_coach_of) returns only this coach's clients.
import { FlatList, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMyClients, useRefreshOnFocus } from '../../src/lib/queries/home';
import { Screen, Text, Card, Avatar, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function ClientsTab() {
  const router = useRouter();
  // Shared cache: ['my-clients'] is warmed on app open and reused by Home + Chat,
  // so this tab is populated on first visit instead of fetching cold.
  const clientsQ = useMyClients();
  useRefreshOnFocus(clientsQ.refetch);

  const clients = clientsQ.data ?? [];
  const loading = clientsQ.isPending;
  const error = clientsQ.isError;
  const load = () => clientsQ.refetch();

  return (
    <Screen padded={false} gradient>
      <View
        style={{
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View>
          <Text variant="h1">Clients</Text>
          <Text variant="caption" muted>
            {clients.length} active
          </Text>
        </View>
        <Card
          onPress={() => router.push('/coach/invite')}
          padded={false}
          style={{ paddingHorizontal: theme.spacing.lg, paddingVertical: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 }}
        >
          <Ionicons name="person-add" size={16} color={theme.colors.primary} />
          <Text variant="bodyStrong" color="primary">
            Invite
          </Text>
        </Card>
      </View>
      <FlatList
        data={clients}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={load} tintColor={theme.colors.primary} />
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="people-outline"
              title={error ? 'Could not load clients' : 'No clients yet'}
              subtitle={error ? 'Pull to retry.' : 'Invite your first client to get started.'}
              actionLabel={error ? undefined : 'Invite a client'}
              onAction={error ? undefined : () => router.push('/coach/invite')}
            />
          )
        }
        renderItem={({ item }) => {
          const label = item.full_name ?? item.invited_email ?? 'Client';
          return (
            <Card
              onPress={() =>
                router.push({ pathname: '/coach/client/[id]', params: { id: item.id, name: label } })
              }
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={label} size={44} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="title">{label}</Text>
                  {item.full_name && item.invited_email ? (
                    <Text variant="caption" muted>
                      {item.invited_email}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
