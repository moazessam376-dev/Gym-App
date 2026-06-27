// Coach → clients tab. RLS (is_coach_of) returns only this coach's clients.
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMyClients, useCoachAdherence, useRefreshOnFocus } from '../../src/lib/queries/home';
import { useIncomingCoachRequests } from '../../src/lib/queries/coach-requests';
import { adherenceScore, type AdherenceRow } from '../../src/lib/analytics';
import { forwardChevron, textStart } from '../../src/lib/rtl';
import { Icon, Screen, Text, Card, Avatar, Badge, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

/** Whole days since a YYYY-MM-DD date (device-local), or null. */
function daysSinceLocal(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(`${dateStr}T00:00:00`).getTime()) / 86_400_000);
}

export default function ClientsTab() {
  const { t } = useTranslation();
  const router = useRouter();
  // Shared cache: ['my-clients'] is warmed on app open and reused by Home + Chat,
  // so this tab is populated on first visit instead of fetching cold.
  const clientsQ = useMyClients();
  const requestsQ = useIncomingCoachRequests();
  const adherenceQ = useCoachAdherence();
  const pendingRequests = requestsQ.data?.length ?? 0;
  useRefreshOnFocus(() => {
    clientsQ.refetch();
    requestsQ.refetch();
    adherenceQ.refetch();
  });

  // Per-client adherence/last-active for the row metadata (turns "list of names" into a
  // coaching surface, distinct from the Chat tab). Same prefetched ['coach-adherence'].
  const adherenceByClient = new Map<string, AdherenceRow>((adherenceQ.data ?? []).map((r) => [r.client_id, r]));

  /** "{pct}% adherence · active {n}d ago" — built from the prefetched adherence row. */
  const clientMeta = (clientId: string): string | null => {
    const row = adherenceByClient.get(clientId);
    if (!row) return null;
    const { overallPct } = adherenceScore(row);
    const days = daysSinceLocal(row.last_session_date);
    const active =
      row.last_session_date == null
        ? t('clients.noSessions')
        : days != null && days <= 0
          ? t('clients.activeToday')
          : t('clients.activeDaysAgo', { count: days ?? 0 });
    const pct = overallPct != null ? t('clients.metaAdherence', { pct: overallPct }) : null;
    return [pct, active].filter(Boolean).join(' · ');
  };

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
          <Text variant="h1">{t('clients.title')}</Text>
          <Text variant="caption" muted>
            {t('clients.activeCount', { count: clients.length })}
          </Text>
        </View>
        {/* Coach day-to-day actions live here (moved out of the Account tab). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <Card
            onPress={() => router.push('/coach/requests')}
            padded={false}
            style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="user-plus" size={16} color={theme.colors.primary} />
            {pendingRequests > 0 ? <Badge label={String(pendingRequests)} tone="primary" solid /> : null}
          </Card>
          <Card
            onPress={() => router.push('/coach/templates')}
            padded={false}
            style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="documents-outline" size={16} color={theme.colors.primary} />
            <Text variant="bodyStrong" color="primary">
              {t('account.planTemplates')}
            </Text>
          </Card>
          <Card
            onPress={() => router.push('/coach/invite')}
            padded={false}
            style={{ paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="person-add" size={16} color={theme.colors.primary} />
            <Text variant="bodyStrong" color="primary">
              {t('clients.invite')}
            </Text>
          </Card>
        </View>
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
              title={error ? t('clients.loadError') : t('clients.emptyTitle')}
              subtitle={error ? t('clients.pullRetry') : t('clients.emptySub')}
              actionLabel={error ? undefined : t('clients.inviteAction')}
              onAction={error ? undefined : () => router.push('/coach/invite')}
            />
          )
        }
        renderItem={({ item }) => {
          const label = item.full_name ?? item.invited_email ?? t('home.client');
          // Coaching metadata (adherence + last-active) when we have it; else the
          // pending-invite email; else nothing.
          const meta = clientMeta(item.id) ?? (item.full_name && item.invited_email ? item.invited_email : null);
          return (
            <Card
              onPress={() =>
                router.push({ pathname: '/coach/client/[id]', params: { id: item.id, name: label } })
              }
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Avatar name={label} size={44} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="title" style={textStart}>{label}</Text>
                  {meta ? (
                    <Text variant="caption" muted style={textStart}>
                      {meta}
                    </Text>
                  ) : null}
                </View>
                <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
