// Client → my plans tab. RLS returns only this client's NON-draft plans.
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../src/lib/auth-context';
import { forwardChevron } from '../../src/lib/rtl';
import {
  pickActiveTrainingPlan,
  useActiveTrainingPlanId,
  usePlansForClient,
  useRefreshOnFocus,
} from '../../src/lib/queries/home';
import { setActiveTrainingPlan } from '../../src/lib/athlete-profile';
import { Icon, Screen, Text, Card, Badge, EmptyState } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function PlansTab() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = session?.user?.id;

  // Cached + warmed on app open, so the plan list is ready on first visit.
  const plansQ = usePlansForClient(userId);
  const activeQ = useActiveTrainingPlanId(userId);
  useRefreshOnFocus(plansQ.refetch);

  const plans = plansQ.data ?? [];
  const loading = plansQ.isPending;
  const load = () => plansQ.refetch();

  // The training plan that actually drives the Home "today" ring: the client's saved
  // choice if it's still valid, else the newest non-archived one — same resolution as
  // fetchTodayWorkout, so the "Active" badge can never disagree with the ring.
  const activeTrainingId = pickActiveTrainingPlan(plans, activeQ.data ?? null)?.id ?? null;

  // Pick which assigned training plan is the active one. Optimistic: invalidate the
  // preference + the Home ring so both re-resolve to the new choice.
  async function makeActive(planId: string) {
    if (!userId || planId === activeTrainingId) return;
    try {
      await setActiveTrainingPlan(userId, planId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['active-training-plan', userId] }),
        queryClient.invalidateQueries({ queryKey: ['today-workout', userId] }),
      ]);
    } catch {
      // Best-effort; the badge stays on the previous choice on failure.
    }
  }

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
                <Icon
                  name={item.type === 'training' ? 'barbell' : 'restaurant'}
                  size={22}
                  color={theme.colors.primary}
                />
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text variant="title">{item.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
                  <Badge label={t(`plans.type.${item.type}`)} tone="secondary" />
                  {item.id === activeTrainingId ? <Badge label={t('plans.active')} tone="primary" /> : null}
                  {item.status === 'archived' ? <Badge label={t('plans.archived')} tone="neutral" /> : null}
                  {/* Multi-plan switching: choose which training plan drives the Home
                      ring. Shown only on the non-active, non-archived training plans. */}
                  {item.type === 'training' && item.status !== 'archived' && item.id !== activeTrainingId ? (
                    <Pressable
                      onPress={() => makeActive(item.id)}
                      hitSlop={6}
                      style={({ pressed }) => ({
                        paddingHorizontal: theme.spacing.sm,
                        paddingVertical: 3,
                        borderRadius: theme.radii.full,
                        borderWidth: 1,
                        borderColor: theme.colors.primary,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text variant="caption" color="primary">
                        {t('plans.makeActive')}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
