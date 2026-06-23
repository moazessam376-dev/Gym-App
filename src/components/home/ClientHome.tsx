// Client dashboard — the flagship. A big animated adherence ring for today's
// workout, a streak chip, and a one-tap "log workout" CTA. Everything here is
// fed by real completion-logging data (migration 0016); nothing is faked.
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
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
import { remaining } from '@/lib/nutrition';
import { Screen, Text, Card, Avatar, Button, ProgressRing, EmptyState } from '@/components/ui';
import { theme } from '@/theme';

export default function ClientHome() {
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
  });

  const name = nameQ.data ?? null;
  const streak = streakQ.data ?? 0;
  const coachName = coachQ.data?.full_name ?? null;
  const coachId = coachQ.data?.id ?? null;
  const needsOnboarding = athleteQ.isSuccess && athleteQ.data?.onboarded_at == null;
  const nutTargets = targetsQ.data ?? null;
  const nutDaily = nutritionQ.data ?? null;

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
          <Text variant="caption" muted>
            {greeting()}
          </Text>
          <Text variant="h1">{name ? name.split(' ')[0] : 'Athlete'}</Text>
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
            <Text variant="bodyStrong">🔥</Text>
            <Text variant="bodyStrong" color="primary">
              {streakQ.isPending ? '—' : streak}
            </Text>
          </View>
          <Pressable onPress={() => router.push('/(tabs)/account')}>
            <Avatar name={name ?? 'Athlete'} size={44} />
          </Pressable>
        </View>
      </View>

      {/* Onboarding nudge — set goals so the coach can tailor the plan */}
      {needsOnboarding ? (
        <Card onPress={() => router.push('/profile-setup')} style={{ borderColor: theme.colors.primary }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
            <Ionicons name="flag" size={22} color={theme.colors.primary} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">Set your goals</Text>
              <Text variant="caption" muted>
                Tell us your goals so your coach can tailor your plan.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
          </View>
        </Card>
      ) : null}

      {/* Hero ring */}
      {today ? (
        <Card style={{ alignItems: 'center', gap: theme.spacing.lg, paddingVertical: theme.spacing.xl }}>
          <Text variant="label" muted>
            Today · {today.name}
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
                {setsDone}/{plannedSets} sets
              </Text>
            </View>
          </ProgressRing>

          {isDone ? (
            <Animated.View
              entering={ZoomIn.springify().damping(12)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Ionicons name="checkmark-circle" size={22} color={theme.colors.success} />
              <Text variant="title" color="success">
                Workout crushed 💥
              </Text>
            </Animated.View>
          ) : (
            <Button
              title={status === 'in_progress' ? 'Continue workout' : 'Start workout'}
              size="lg"
              onPress={openWorkout}
              left={<Ionicons name="flash" size={18} color={theme.colors.onPrimary} />}
            />
          )}
          {isDone ? (
            <Button title="Review workout" variant="ghost" onPress={openWorkout} />
          ) : null}
        </Card>
      ) : workoutLoading ? null : (
        <Card padded={false}>
          <EmptyState
            icon="barbell-outline"
            title="No training plan yet"
            subtitle={
              coachName
                ? `${coachName} will assign your plan soon.`
                : 'Once you have a coach and a plan, your daily workout shows up here.'
            }
          />
        </Card>
      )}

      {/* Nutrition today — links into the Nutrition tab */}
      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="label" muted>
          Nutrition today
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
                <Text variant="title">{nutLeft} kcal left</Text>
                <Text variant="caption" muted>
                  {consumedKcal} / {targetKcal} kcal · {nutDaily?.protein_total ?? 0}P / {nutDaily?.carbs_total ?? 0}C / {nutDaily?.fat_total ?? 0}F
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Ionicons name="restaurant" size={22} color={theme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">Track your nutrition</Text>
                <Text variant="caption" muted>
                  Set a daily target and log your meals.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
            </View>
          )}
        </Card>
      </View>

      {/* Coach card */}
      {coachName ? (
        <View style={{ gap: theme.spacing.sm }}>
          <Text variant="label" muted>
            Your coach
          </Text>
          <Card
            onPress={
              coachId
                ? () => router.push({ pathname: '/chat/[id]', params: { id: coachId, name: coachName ?? 'Your coach' } })
                : undefined
            }
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}>
              <Avatar name={coachName} size={40} />
              <Text variant="title" style={{ flex: 1 }}>
                {coachName}
              </Text>
              <Ionicons name="chatbubble-ellipses" size={22} color={theme.colors.primary} />
            </View>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
