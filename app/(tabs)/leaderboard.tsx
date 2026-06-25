// Coach → leaderboard tab. Ranks the coach's OWN clients by sessions completed
// this week. Data comes from the coach_leaderboard RPC (server-fenced to the
// caller's cohort — it can never leak another coach's clients).
import { FlatList, RefreshControl, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useCoachLeaderboard, useRefreshOnFocus } from '../../src/lib/queries/home';
import { Screen, Text, Card, Avatar, Badge, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function LeaderboardTab() {
  const { t } = useTranslation();
  // Cached + warmed on app open; ranking (sort + rank index) happens in the query.
  const boardQ = useCoachLeaderboard();
  useRefreshOnFocus(boardQ.refetch);

  const ranked = boardQ.data ?? [];
  const loading = boardQ.isPending;
  const load = () => boardQ.refetch();

  return (
    <Screen padded={false} gradient>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Text variant="h1">{t('ranks.thisWeek')}</Text>
        <Text variant="caption" muted>
          {t('ranks.subtitle')}
        </Text>
      </View>
      <FlatList
        data={ranked}
        keyExtractor={(r) => r.client_id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={load} tintColor={theme.colors.primary} />
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="trophy-outline"
              title={t('ranks.emptyTitle')}
              subtitle={t('ranks.emptySub')}
            />
          )
        }
        renderItem={({ item }) => {
          const topThree = item.rank <= 3;
          return (
            <Card
              elevated={topThree}
              style={item.rank === 1 ? { borderColor: theme.colors.primary } : undefined}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <View style={{ width: 28, alignItems: 'center' }}>
                  <Text
                    color={topThree ? theme.colors.primary : theme.colors.textMuted}
                    style={{ fontFamily: theme.fontFamily.monoBold, fontSize: 16 }}
                  >
                    {item.rank}
                  </Text>
                </View>
                <Avatar name={item.full_name ?? 'Client'} size={40} />
                <View style={{ flex: 1 }}>
                  <Text variant="title">{item.full_name ?? t('home.client')}</Text>
                  <Text variant="caption" muted>
                    {t('ranks.setsLogged', { count: item.sets_done })}
                  </Text>
                </View>
                <Badge label={String(item.sessions_done)} tone="primary" solid={item.rank === 1} />
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
