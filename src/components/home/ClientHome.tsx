// Client dashboard — the flagship. A big animated adherence ring for today's
// workout, a streak chip, and a one-tap "log workout" CTA. Everything here is
// fed by real completion-logging data (migration 0016); nothing is faked.
import { Pressable, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth-context';
import { forwardChevron, textStart } from '@/lib/rtl';
import {
  useMyName,
  useStreak,
  useMyCoach,
  useMyAthleteProfile,
  useTargets,
  useDailyNutrition,
  useTodayWorkout,
  useRefreshOnFocus,
} from '@/lib/queries/home';
import { useMyLeagueStanding } from '@/lib/queries/leaderboards';
import { TIER_COLORS } from '@/lib/leagues';
import { remaining } from '@/lib/nutrition';
import { Icon, Screen, Text, Card, Avatar, Button, ProgressRing, EmptyState } from '@/components/ui';
import { NotificationBell } from '@/components/NotificationBell';
import { theme } from '@/theme';

export default function ClientHome() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  // Each read is its own cached query (keyed per user), so revisiting the tab
  // renders last-known values INSTANTLY — no more streak flashing 0→3. The slow
  // plan→day→session walk is its own query so it can't block name/streak.
  const nameQ = useMyName(userId);
  const streakQ = useStreak(userId);
  const coachQ = useMyCoach(userId);
  const athleteQ = useMyAthleteProfile(userId);
  const targetsQ = useTargets(userId);
  const nutritionQ = useDailyNutrition(userId);
  const workoutQ = useTodayWorkout(userId);
  const leagueQ = useMyLeagueStanding(userId);

  // Refetch in the background when the tab regains focus (fresh data after logging
  // elsewhere) without flashing — cached values stay on screen during the refetch.
  useRefreshOnFocus(() => {
    nameQ.refetch();
    streakQ.refetch();
    coachQ.refetch();
    athleteQ.refetch();
    targetsQ.refetch();
    nutritionQ.refetch();
    workoutQ.refetch();
    leagueQ.refetch();
  });

  const name = nameQ.data ?? null;
  const streak = streakQ.data ?? 0;
  const coachName = coachQ.data?.full_name ?? null;
  const coachId = coachQ.data?.id ?? null;
  const needsOnboarding = athleteQ.isSuccess && athleteQ.data?.onboarded_at == null;
  const nutTargets = targetsQ.data ?? null;
  const nutDaily = nutritionQ.data ?? null;

  // League standing CTA (Phase 20). Four states: ranked & opted-in, ranked but not opted
  // in, has a verified reading but no placement (missing sex/height), or no reading yet.
  const league = leagueQ.data ?? null;
  const leagueTier = league?.tier ?? null;
  const leagueAccent = leagueTier ? TIER_COLORS[leagueTier] : theme.colors.primary;
  const leagueTitle = leagueTier
    ? t('home.leagueTitle', { tier: t(`leaderboards.tier.${leagueTier}`) })
    : t('home.leagueJoinTitle');
  const leagueSub = !league
    ? ''
    : !league.hasVerifiedReading
      ? t('home.leagueNoReading')
      : leagueTier == null
        ? t('home.leagueNeedsProfile')
        : league.optedIn
          ? t('home.leagueRanked')
          : t('home.leagueOptIn');

  const today = workoutQ.data?.today ?? null;
  const plannedSets = workoutQ.data?.plannedSets ?? 0;
  const setsDone = workoutQ.data?.setsDone ?? 0;
  const status = workoutQ.data?.status ?? 'none';
  const workoutLoading = workoutQ.isPending;

  const progress = plannedSets > 0 ? setsDone / plannedSets : status === 'completed' ? 1 : 0;
  const pct = Math.round(progress * 100);
  const isDone = status === 'completed';

  const consumedKcal = nutDaily?.kcal_total ?? 0;
  const targetKcal = nutTargets?.kcal_target ?? 0;
  const nutLeft = remaining(consumedKcal, targetKcal);
  const nutProgress = targetKcal > 0 ? Math.min(1, consumedKcal / targetKcal) : 0;

  const openWorkout = () => {
    if (!today) return;
    router.push({
      pathname: '/client/workout/[dayId]',
      params: { dayId: today.id, planId: today.planId, name: today.name },
    });
  };

  return (
    <Screen scroll gradient contentStyle={{ paddingTop: theme.spacing.lg, gap: theme.spacing.xl }}>
      {/* Top bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text variant="caption" muted style={textStart}>
            {t(greetingKey())}
          </Text>
          <Text variant="h1" style={textStart}>
            {name ? name.split(' ')[0] : t('home.athlete')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderWidth: 1,
              borderRadius: theme.radii.full,
              paddingHorizontal: theme.spacing.md,
              paddingVertical: 6,
            }}
          >
            <Icon name="flame" size={16} color={theme.colors.primary} />
            <Text variant="mono" color="primary">
              {streakQ.isPending ? '—' : streak}
            </Text>
          </View>
          <NotificationBell />
          <Pressable onPress={() => router.push('/(tabs)/account')}>
            <Avatar name={name ?? 'Athlete'} size={44} />
          </Pressable>
        </View>
      </View>

      {/* Onboarding nudge — set goals so the coach can tailor the plan */}
      {needsOnboarding ? (
        <Card onPress={() => router.push('/profile-setup')} style={{ borderColor: theme.colors.primary }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Icon name="flag" size={22} color={theme.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{t('home.setGoalsTitle')}</Text>
              <Text variant="caption" muted>
                {t('home.setGoalsSub')}
              </Text>
            </View>
            <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
          </View>
        </Card>
      ) : null}

      {/* Hero ring */}
      {today ? (
        <Card style={{ alignItems: 'center', gap: theme.spacing.lg, paddingVertical: theme.spacing.xl }}>
          <Text variant="label" muted>
            {t('home.todayDay', { day: today.name })}
          </Text>
          <ProgressRing progress={progress} size={220} strokeWidth={18}>
            <View style={{ alignItems: 'center' }}>
              <Animated.View key={pct} entering={ZoomIn.duration(400)}>
                <Text variant="display" style={{ fontSize: 56, lineHeight: 60 }}>
                  {pct}
                  <Text variant="h2" color="textMuted">
                    %
                  </Text>
                </Text>
              </Animated.View>
              <Text variant="caption" muted>
                {t('home.setsCount', { done: setsDone, planned: plannedSets })}
              </Text>
            </View>
          </ProgressRing>

          {isDone ? (
            <Animated.View
              entering={ZoomIn.springify().damping(12)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Icon name="checkmark-circle" size={22} color={theme.colors.success} />
              <Text variant="title" color="success">
                {t('home.workoutCrushed')}
              </Text>
            </Animated.View>
          ) : (
            <Button
              title={status === 'in_progress' ? t('home.continueWorkout') : t('home.startWorkout')}
              size="lg"
              onPress={openWorkout}
              left={<Icon name="flash" size={18} color={theme.colors.onPrimary} />}
            />
          )}
          {isDone ? (
            <Button title={t('home.reviewWorkout')} variant="ghost" onPress={openWorkout} />
          ) : null}
        </Card>
      ) : workoutLoading ? null : (
        <Card padded={false}>
          <EmptyState
            icon="barbell-outline"
            title={t('home.noPlanTitle')}
            subtitle={
              coachName
                ? t('home.noPlanWithCoach', { coach: coachName })
                : t('home.noPlanNoCoach')
            }
          />
        </Card>
      )}

      {/* Nutrition today — links into the Nutrition tab */}
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" muted>
          {t('home.nutritionToday')}
        </Text>
        <Card onPress={() => router.push('/(tabs)/nutrition')}>
          {nutTargets ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.lg }}>
              <ProgressRing progress={nutProgress} size={76} strokeWidth={8}>
                <Text variant="bodyStrong" style={{ fontSize: 12 }}>
                  {nutLeft}
                </Text>
              </ProgressRing>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="title">{t('home.kcalLeft', { left: nutLeft })}</Text>
                <Text variant="caption" muted>
                  {t('home.macroLine', {
                    consumed: consumedKcal,
                    target: targetKcal,
                    p: nutDaily?.protein_total ?? 0,
                    c: nutDaily?.carbs_total ?? 0,
                    f: nutDaily?.fat_total ?? 0,
                  })}
                </Text>
              </View>
              <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Icon name="restaurant" size={22} color={theme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">{t('home.trackNutritionTitle')}</Text>
                <Text variant="caption" muted>
                  {t('home.trackNutritionSub')}
                </Text>
              </View>
              <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
            </View>
          )}
        </Card>
      </View>

      {/* Coach card */}
      {coachName ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted>
            {t('home.yourCoach')}
          </Text>
          <Card
            onPress={
              coachId
                ? () => router.push({ pathname: '/chat/[id]', params: { id: coachId, name: coachName ?? t('home.yourCoach') } })
                : undefined
            }
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Avatar name={coachName} size={40} />
              <Text variant="title" style={{ flex: 1 }}>
                {coachName}
              </Text>
              <Icon name="chatbubble-ellipses" size={22} color={theme.colors.primary} />
            </View>
          </Card>
        </View>
      ) : null}

      {/* League standing — the leaderboard hook (Phase 20). Shown even before opting in. */}
      {league ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted style={textStart}>
            {t('home.league')}
          </Text>
          <Card onPress={() => router.push('/leaderboards')} style={{ borderColor: leagueAccent }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Icon name="trophy" size={22} color={leagueAccent} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" style={textStart}>
                  {leagueTitle}
                  {leagueTier && league.ffmi != null ? `  ·  ${league.ffmi.toFixed(1)} ${t('leaderboards.ffmi')}` : ''}
                </Text>
                <Text variant="caption" muted style={textStart}>
                  {leagueSub}
                </Text>
              </View>
              <Icon name={forwardChevron()} size={20} color={theme.colors.textMuted} />
            </View>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

function greetingKey(): string {
  const h = new Date().getHours();
  if (h < 12) return 'home.goodMorning';
  if (h < 18) return 'home.goodAfternoon';
  return 'home.goodEvening';
}
