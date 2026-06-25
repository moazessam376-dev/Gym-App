// Client → progress tab (Phase 11 hub). Streak + workout history (completion
// logging) PLUS the progress pillars: weight trend, photos, and InBody scans.
// Each pillar card taps through to its dedicated screen.
import { useMemo } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../src/lib/auth-context';
import { forwardChevron } from '../../src/lib/rtl';
import { useStreak, useProgressData, useRefreshOnFocus } from '../../src/lib/queries/home';
import { gramsToDisplay, formatWeight } from '../../src/lib/units';
import { Icon, type IconName, Screen, Text, Card, GlassCard, Badge, EmptyState, LineChart } from '../../src/components/ui';
import { theme } from '../../src/theme';

function formatDate(d: string): string {
  // d is 'YYYY-MM-DD' — render as a friendly local label.
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// One tappable pillar row (Photos / InBody): icon + label + count + chevron.
function PillarRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <GlassCard onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radii.md,
            backgroundColor: theme.colors.glassStrong,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={20} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">{label}</Text>
          <Text variant="caption" muted>
            {hint}
          </Text>
        </View>
        <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
      </View>
    </GlassCard>
  );
}

export default function ProgressTab() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  // Streak is the SAME cached query as Home/Nutrition; the rest is one cached
  // composite. Both are warmed on app open, so the tab is ready on first visit.
  const streakQ = useStreak(userId);
  const progressQ = useProgressData(userId);
  useRefreshOnFocus(() => {
    streakQ.refetch();
    progressQ.refetch();
  });

  const streak = streakQ.data ?? 0;
  const sessions = progressQ.data?.sessions ?? [];
  const weights = progressQ.data?.weights ?? [];
  const unit = progressQ.data?.unit ?? 'kg';
  const photoCount = progressQ.data?.photoCount ?? 0;
  const inbodyCount = progressQ.data?.inbodyCount ?? 0;
  const bodyMetrics = progressQ.data?.bodyMetrics ?? [];
  const loading = progressQ.isPending;
  const load = () => {
    streakQ.refetch();
    progressQ.refetch();
  };

  const completed = sessions.filter((s) => s.status === 'completed').length;

  const chartData = useMemo(
    () => weights.map((e) => ({ value: gramsToDisplay(e.weight_grams, unit) ?? 0, label: shortDate(e.recorded_at) })),
    [weights, unit],
  );
  const latestWeight = weights.length ? weights[weights.length - 1]! : null;
  const latestBodyComp = bodyMetrics.length ? bodyMetrics[bodyMetrics.length - 1]! : null;

  return (
    <Screen padded={false} gradient>
      <View style={{ paddingHorizontal: theme.spacing.lg, paddingTop: theme.spacing.lg }}>
        <Text variant="h1">{t('progress.title')}</Text>
      </View>
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: theme.spacing.lg, gap: theme.spacing.md, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={load} tintColor={theme.colors.primary} />
        }
        ListHeaderComponent={
          <View style={{ gap: theme.spacing.md, marginBottom: theme.spacing.sm }}>
            <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
              <Card style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <Text variant="display" color="primary">
                  {streak}
                </Text>
                <Text variant="label" muted>
                  {t('progress.dayStreak')}
                </Text>
              </Card>
              <Card style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                <Text variant="display">{completed}</Text>
                <Text variant="label" muted>
                  {t('progress.workoutsDone')}
                </Text>
              </Card>
            </View>

            {/* Weight trend */}
            <GlassCard onPress={() => router.push('/client/progress/weight')} style={{ gap: theme.spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="label" muted>
                  {t('progress.weight')}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
                  <Text variant="bodyStrong" color="primary">
                    {latestWeight ? formatWeight(latestWeight.weight_grams, unit) : t('progress.logWeight')}
                  </Text>
                  <Icon name={forwardChevron()} size={18} color={theme.colors.textMuted} />
                </View>
              </View>
              {chartData.length >= 2 ? (
                <LineChart data={chartData} unit={` ${unit}`} height={140} />
              ) : (
                <Text variant="caption" muted>
                  {latestWeight ? t('progress.logAgainTrend') : t('progress.trackWeightOverTime')}
                </Text>
              )}
            </GlassCard>

            {/* Photos + InBody */}
            <PillarRow
              icon="camera"
              label={t('progress.progressPhotos')}
              hint={photoCount > 0 ? t('progress.photoCount', { count: photoCount }) : t('progress.addFirstPhoto')}
              onPress={() => router.push('/client/progress/photos')}
            />
            <PillarRow
              icon="document-text"
              label={t('progress.inbodyScans')}
              hint={inbodyCount > 0 ? t('progress.scanCount', { count: inbodyCount }) : t('progress.addScan')}
              onPress={() => router.push('/client/progress/inbody')}
            />
            <PillarRow
              icon="body"
              label={t('progress.bodyComposition')}
              hint={
                latestBodyComp
                  ? t('progress.bodyCompWeight', { kg: Math.round((latestBodyComp.weight_grams / 1000) * 10) / 10 }) +
                    (latestBodyComp.body_fat_bp != null
                      ? t('progress.bodyCompFat', { pct: Math.round((latestBodyComp.body_fat_bp / 100) * 10) / 10 })
                      : '')
                  : t('progress.bodyCompFallback')
              }
              onPress={() => router.push('/client/progress/body-comp')}
            />

            <Text variant="label" muted style={{ marginTop: theme.spacing.xs }}>
              {t('progress.recentWorkouts')}
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="trending-up-outline"
              title={t('progress.noWorkoutsTitle')}
              subtitle={t('progress.noWorkoutsSub')}
            />
          )
        }
        renderItem={({ item }) => {
          // Tappable when it points at a planned day — opens/continues that workout.
          const open = item.day_id
            ? () =>
                router.push({
                  pathname: '/client/workout/[dayId]',
                  params: { dayId: item.day_id!, planId: item.plan_id ?? '' },
                })
            : undefined;
          return (
            <Card onPress={open}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
                <Icon
                  name={item.status === 'completed' ? 'checkmark-circle' : 'ellipse-outline'}
                  size={26}
                  color={item.status === 'completed' ? theme.colors.success : theme.colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{formatDate(item.session_date)}</Text>
                  <Text variant="caption" muted>
                    {item.note ? item.note : item.status === 'in_progress' ? t('progress.tapContinue') : t('progress.tapReview')}
                  </Text>
                </View>
                <Badge
                  label={t(`progress.status.${item.status === 'in_progress' ? 'inProgress' : item.status}`)}
                  tone={item.status === 'completed' ? 'success' : 'neutral'}
                />
              </View>
            </Card>
          );
        }}
      />
    </Screen>
  );
}
