// Client dashboard — the flagship. A big animated adherence ring for today's
// workout, a streak chip, and a one-tap "log workout" CTA. Everything here is
// fed by real completion-logging data (migration 0016); nothing is faked.
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@/lib/auth-context';
import { getMyName } from '@/lib/profile';
import { getMyAthleteProfile } from '@/lib/athlete-profile';
import { getMyCoach } from '@/lib/invitations';
import { listPlansForClient, listWeeks, listDays, listExerciseRows } from '@/lib/plans';
import {
  getAdherence,
  getSessionForDay,
  getStreak,
  todayLocalDate,
  type SessionStatus,
} from '@/lib/sessions';
import { Screen, Text, Card, Avatar, Button, ProgressRing, EmptyState } from '@/components/ui';
import { theme } from '@/theme';

type TodayDay = { id: string; name: string; planId: string };

export default function ClientHome() {
  const { session } = useAuth();
  const router = useRouter();
  const userId = session?.user?.id;

  const [name, setName] = useState<string | null>(null);
  const [coachName, setCoachName] = useState<string | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [today, setToday] = useState<TodayDay | null>(null);
  const [plannedSets, setPlannedSets] = useState(0);
  const [setsDone, setSetsDone] = useState(0);
  const [status, setStatus] = useState<SessionStatus | 'none'>('none');
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [n, s, coach, plans, athlete] = await Promise.all([
        getMyName(userId),
        getStreak(userId),
        getMyCoach(userId),
        listPlansForClient(userId),
        getMyAthleteProfile(userId),
      ]);
      setName(n);
      setStreak(s);
      setCoachName(coach?.full_name ?? null);
      setCoachId(coach?.id ?? null);
      setNeedsOnboarding(athlete?.onboarded_at == null);

      // Active training plan = most recent non-archived training plan.
      const plan = plans.find((p) => p.type === 'training' && p.status !== 'archived');
      if (!plan) {
        setToday(null);
        return;
      }
      const weeks = await listWeeks(plan.id);
      const week = weeks[0];
      const days = week ? await listDays(week.id) : [];
      const day = days[0];
      if (!day) {
        setToday(null);
        return;
      }
      setToday({ id: day.id, name: day.name, planId: plan.id });

      const exercises = await listExerciseRows(day.id);
      const planned = exercises.reduce((sum, e) => sum + (e.sets ?? 0), 0);

      const existing = await getSessionForDay(userId, day.id, todayLocalDate());
      if (existing) {
        setStatus(existing.status);
        const adh = await getAdherence(existing.id);
        setSetsDone(adh?.sets_done ?? 0);
        setPlannedSets(adh?.sets_planned || planned);
      } else {
        setStatus('none');
        setSetsDone(0);
        setPlannedSets(planned);
      }
    } catch {
      /* keep prior */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const progress = plannedSets > 0 ? setsDone / plannedSets : status === 'completed' ? 1 : 0;
  const pct = Math.round(progress * 100);
  const isDone = status === 'completed';

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
              {streak}
            </Text>
          </View>
          <Avatar name={name ?? 'Athlete'} size={44} />
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
      ) : loading ? null : (
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
