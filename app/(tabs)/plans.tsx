// Client → my plans tab. RLS returns only this client's NON-draft plans.
import { FlatList, RefreshControl, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { forwardChevron } from '../../src/lib/rtl';
import { usePlansForClient, useRefreshOnFocus } from '../../src/lib/queries/home';
import { Screen, Text, Card, Badge, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function PlansTab() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  // Cached + warmed on app open, so the plan list is ready on first visit.
  const plansQ = usePlansForClient(userId);
  useRefreshOnFocus(plansQ.refetch);

  const plans = plansQ.data ?? [];
  const loading = plansQ.isPending;
  const load = () => plansQ.refetch();

  return (
    <Screen padded={false} gradient>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Text variant="h1">{t('plans.title')}</Text>
        <Text variant="caption" muted>
          {t('plans.subtitle')}
        </Text>
      </View>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={load} tintColor={theme.colors.primary} />
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="barbell-outline"
              title={t('plans.emptyTitle')}
              subtitle={t('plans.emptySub')}
            />
          )
        }
        renderItem={({ item }) => (
          <Card onPress={() => router.push({ pathname: '/client/plan/[id]', params: { id: item.id } })}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: theme.radii.md,
                  backgroundColor: theme.colors.surfaceElevated,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={item.type === 'training' ? 'barbell' : 'restaurant'}
                  size={22}
                  color={theme.colors.primary}
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="title">{item.title}</Text>
                <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
                  <Badge label={t(`plans.type.${item.type}`)} tone="secondary" />
                  {item.status === 'archived' ? <Badge label={t('plans.archived')} tone="neutral" /> : null}
                </View>
              </View>
              <Ionicons name={forwardChevron()} size={20} color={theme.colors.textMuted} />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
