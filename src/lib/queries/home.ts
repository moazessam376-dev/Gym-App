// Query hooks for every primary tab screen. They wrap the EXISTING lib fns (no new
// data or SQL) so cached values render instantly across remounts and first-visits —
// this is what kills the "flash then fill" / zero-then-value loading you see when
// hopping tabs. Query keys are user-scoped so a logout/login can never bleed one
// account's cache into another. Several screens share a key (e.g. ['my-clients'] is
// read by Home, Clients and Chat) so warming it once makes all of them instant.
import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/query';
import { supabase } from '@/lib/supabase';
import {
  getUnreadCount,
  listNotifications,
  subscribeToNotifications,
} from '@/lib/notifications';
import type { Role } from '@/schemas/profile';
import { getMyName } from '@/lib/profile';
import { getMyAthleteProfile } from '@/lib/athlete-profile';
import { getMyLeagueStanding } from '@/lib/leagues';
import { getMyCoach, listMyClients, listMyInvitations } from '@/lib/invitations';
import { listPlansForClient, listWeeks, listDays, listExerciseRows } from '@/lib/plans';
import {
  getAdherence,
  getCoachLeaderboard,
  getSessionForDay,
  getStreak,
  listSessions,
  todayLocalDate,
  type LeaderboardRow,
  type SessionStatus,
  type WorkoutSession,
} from '@/lib/sessions';
import {
  estimateTargets,
  getAssignedNutritionPlanId,
  getAssignedNutritionPlanMeals,
  getDailyNutrition,
  getLatestWeightGrams,
  getNutritionStreak,
  getTargets,
  listFoodLog,
  plannedDailyMacros,
  type DailyNutrition,
  type FoodLogEntry,
  type NutritionTargets,
  type PlanMealWithItems,
} from '@/lib/nutrition';
import type { UpsertTargets } from '@/schemas/nutrition';
import { listProgressWeights, type WeightEntry } from '@/lib/progress';
import { getBodyMetricsBoard, listBodyMetrics, rankBoard, type BodyMetric } from '@/lib/body-metrics';
import {
  getAdherenceOverview,
  getAnalyticsInsight,
  getPlanEffectiveness,
} from '@/lib/analytics';
import { countMediaFor } from '@/lib/media';
import { listConversationPreviews, subscribeToIncoming } from '@/lib/messages';
import type { WeightUnit } from '@/lib/units';

// ---- shared identity / relationship reads ----

export function useMyName(userId?: string) {
  return useQuery({
    queryKey: ['my-name', userId],
    queryFn: () => getMyName(userId!),
    enabled: !!userId,
  });
}

export function useStreak(userId?: string) {
  return useQuery({
    queryKey: ['streak', userId],
    queryFn: () => getStreak(userId),
    enabled: !!userId,
  });
}

export function useMyCoach(userId?: string) {
  return useQuery({
    queryKey: ['my-coach', userId],
    queryFn: () => getMyCoach(userId!),
    enabled: !!userId,
  });
}

export function useMyAthleteProfile(userId?: string) {
  return useQuery({
    queryKey: ['athlete-profile', userId],
    queryFn: () => getMyAthleteProfile(userId!),
    enabled: !!userId,
  });
}

// ---- client: home ring + plans + nutrition ----

export function useTargets(userId?: string) {
  return useQuery({
    queryKey: ['nutrition-targets', userId],
    queryFn: () => getTargets(userId!),
    enabled: !!userId,
  });
}

export function useDailyNutrition(userId?: string) {
  const today = todayLocalDate();
  return useQuery({
    queryKey: ['daily-nutrition', userId, today],
    queryFn: () => getDailyNutrition(userId!, today),
    enabled: !!userId,
  });
}

export function usePlansForClient(userId?: string) {
  return useQuery({
    queryKey: ['plans-for-client', userId],
    queryFn: () => listPlansForClient(userId!),
    enabled: !!userId,
  });
}

export type TodayWorkout = {
  today: { id: string; name: string; planId: string } | null;
  plannedSets: number;
  setsDone: number;
  status: SessionStatus | 'none';
};

/** The training plan that should drive the Home ring: the client's chosen one if it
 *  is still a valid (non-archived) training plan of theirs, else the newest one. The
 *  preferred id is honored only when it resolves within the caller's own plans, so a
 *  stale or forged preference degrades to "newest", never a cross-tenant pick. */
export function pickActiveTrainingPlan<T extends { id: string; type: string; status: string }>(
  plans: T[],
  preferredId: string | null,
): T | null {
  const training = plans.filter((p) => p.type === 'training' && p.status !== 'archived');
  return training.find((p) => p.id === preferredId) ?? training[0] ?? null;
}

// The active training day + today's adherence. Same plan→week→day→session walk the
// dashboard did inline, moved into one cached query so the hero ring is instant on
// revisit (and the slow chain doesn't block name/streak — those are separate queries).
async function fetchTodayWorkout(userId: string): Promise<TodayWorkout> {
  const today = todayLocalDate();
  const empty: TodayWorkout = { today: null, plannedSets: 0, setsDone: 0, status: 'none' };
  const [plans, profile] = await Promise.all([
    listPlansForClient(userId),
    getMyAthleteProfile(userId),
  ]);
  const plan = pickActiveTrainingPlan(plans, profile?.active_training_plan_id ?? null);
  if (!plan) return empty;
  const weeks = await listWeeks(plan.id);
  const week = weeks[0];
  const days = week ? await listDays(week.id) : [];
  const day = days[0];
  if (!day) return empty;
  const exercises = await listExerciseRows(day.id);
  const planned = exercises.reduce((sum, e) => sum + (e.sets ?? 0), 0);
  const target = { id: day.id, name: day.name, planId: plan.id };
  const existing = await getSessionForDay(userId, day.id, today);
  if (existing) {
    const adh = await getAdherence(existing.id);
    return {
      today: target,
      plannedSets: adh?.sets_planned || planned,
      setsDone: adh?.sets_done ?? 0,
      status: existing.status,
    };
  }
  return { today: target, plannedSets: planned, setsDone: 0, status: 'none' };
}

export function useTodayWorkout(userId?: string) {
  return useQuery({
    queryKey: ['today-workout', userId],
    queryFn: () => fetchTodayWorkout(userId!),
    enabled: !!userId,
  });
}

// The client's chosen active training plan id (drives the Home ring + the "Active"
// badge / switcher on the Plans tab). Separate small query so flipping it can
// invalidate just this + ['today-workout'] without refetching the whole profile.
export function useActiveTrainingPlanId(userId?: string) {
  return useQuery({
    queryKey: ['active-training-plan', userId],
    queryFn: async () => (await getMyAthleteProfile(userId!))?.active_training_plan_id ?? null,
    enabled: !!userId,
  });
}

// ---- client: nutrition tab (one cached composite per day) ----

export type NutritionDay = {
  entries: FoodLogEntry[];
  daily: DailyNutrition | null;
  targets: NutritionTargets | null;
  streak: number;
  planMeals: PlanMealWithItems[];
  estimate: UpsertTargets | null;
  planTargets: UpsertTargets | null;
};

async function fetchNutritionDay(userId: string, date: string): Promise<NutritionDay> {
  const [entries, daily, targets, streak, planMeals] = await Promise.all([
    listFoodLog(userId, date),
    getDailyNutrition(userId, date),
    getTargets(userId),
    getNutritionStreak(userId),
    getAssignedNutritionPlanMeals(userId),
  ]);
  let estimate: UpsertTargets | null = null;
  let planTargets: UpsertTargets | null = null;
  if (!targets) {
    const [profile, weight, planId] = await Promise.all([
      getMyAthleteProfile(userId),
      getLatestWeightGrams(userId),
      getAssignedNutritionPlanId(userId),
    ]);
    estimate = profile ? estimateTargets(profile, weight) : null;
    planTargets = planId ? await plannedDailyMacros(planId) : null;
  }
  return { entries, daily, targets, streak, planMeals, estimate, planTargets };
}

export function useNutritionDay(userId: string | undefined, date: string) {
  return useQuery({
    queryKey: ['nutrition-day', userId, date],
    queryFn: () => fetchNutritionDay(userId!, date),
    enabled: !!userId,
  });
}

// ---- client: progress tab (streak is the shared ['streak'] query; the rest here) ----

export type ProgressData = {
  sessions: WorkoutSession[];
  weights: WeightEntry[];
  unit: WeightUnit;
  photoCount: number;
  inbodyCount: number;
  bodyMetrics: BodyMetric[];
};

async function fetchProgressData(userId: string): Promise<ProgressData> {
  // allSettled so one failing read (e.g. an empty media list vs a transient error)
  // can't blank the whole screen — mirrors the screen's original tolerance.
  const [list, w, profile, photos, inbody, bm] = await Promise.allSettled([
    listSessions(userId),
    listProgressWeights(userId),
    getMyAthleteProfile(userId),
    countMediaFor(userId, 'progress_photo'),
    countMediaFor(userId, 'inbody'),
    listBodyMetrics(userId),
  ]);
  return {
    sessions: list.status === 'fulfilled' ? list.value : [],
    weights: w.status === 'fulfilled' ? w.value : [],
    unit: profile.status === 'fulfilled' && profile.value?.weight_unit ? profile.value.weight_unit : 'kg',
    photoCount: photos.status === 'fulfilled' ? photos.value : 0,
    inbodyCount: inbody.status === 'fulfilled' ? inbody.value : 0,
    bodyMetrics: bm.status === 'fulfilled' ? bm.value : [],
  };
}

export function useProgressData(userId?: string) {
  return useQuery({
    queryKey: ['progress-data', userId],
    queryFn: () => fetchProgressData(userId!),
    enabled: !!userId,
  });
}

// ---- coach: clients / chat / hub / ranks ----

export function useMyClients() {
  return useQuery({ queryKey: ['my-clients'], queryFn: listMyClients });
}

export function useMyInvitations() {
  return useQuery({ queryKey: ['my-invitations'], queryFn: listMyInvitations });
}

export function useBodyMetricsBoard() {
  return useQuery({ queryKey: ['coach-board'], queryFn: getBodyMetricsBoard, select: rankBoard });
}

async function fetchCoachLeaderboard(): Promise<(LeaderboardRow & { rank: number })[]> {
  const data = await getCoachLeaderboard();
  data.sort((a, b) => b.sessions_done - a.sessions_done || b.sets_done - a.sets_done);
  return data.map((r, i) => ({ ...r, rank: i + 1 }));
}

export function useCoachLeaderboard() {
  return useQuery({ queryKey: ['coach-leaderboard'], queryFn: fetchCoachLeaderboard });
}

// ---- notifications (all roles): feed + unread badge + live updates ----

export function useNotifications(userId?: string) {
  return useQuery({
    queryKey: ['notifications', userId],
    queryFn: () => listNotifications(),
    enabled: !!userId,
  });
}

export function useUnreadNotificationCount(userId?: string) {
  return useQuery({
    queryKey: ['notifications-unread', userId],
    queryFn: () => getUnreadCount(),
    enabled: !!userId,
  });
}

// Subscribe once (at the app root) to live notifications for the signed-in user and
// invalidate the feed + badge on each insert, so the bell count updates without a
// manual refresh. Realtime respects RLS — only the user's own rows arrive.
export function useNotificationsRealtime(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    const channel = subscribeToNotifications(userId, () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread', userId] });
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}

// ---- chat: conversation previews (last message + unread) for the Chat tab ----

export function useConversationPreviews() {
  return useQuery({ queryKey: ['conversation-previews'], queryFn: listConversationPreviews });
}

// Subscribe once (at the app root) to incoming messages and invalidate the chat-list
// previews + the coach Home unread tile, so the list re-sorts and the unread badge
// updates live. Reuses the RLS-scoped incoming channel.
export function useConversationPreviewsRealtime(userId?: string) {
  useEffect(() => {
    if (!userId) return;
    const channel = subscribeToIncoming(userId, () => {
      queryClient.invalidateQueries({ queryKey: ['conversation-previews'] });
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);
}

// ---- coach: KPI analytics tab (Phase 15) ----

export function useCoachAdherence() {
  return useQuery({ queryKey: ['coach-adherence'], queryFn: () => getAdherenceOverview() });
}

export function useCoachPlanEffectiveness() {
  return useQuery({ queryKey: ['coach-plan-effectiveness'], queryFn: getPlanEffectiveness });
}

export function useAnalyticsInsight() {
  return useQuery({ queryKey: ['analytics-insight'], queryFn: getAnalyticsInsight });
}

// ---- focus refresh + prefetch ----

// Refetch in the background when the tab regains focus (so returning after a change
// elsewhere shows fresh data) WITHOUT a flash — cached data stays rendered while the
// refetch runs. Skips the first focus (useQuery already fetched on mount).
export function useRefreshOnFocus(refetch: () => void) {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      refetch();
    }, [refetch]),
  );
}

// The "load buffer" on app open: warm EVERY tab's cache for the role and RESOLVE
// when they've all settled, so the boot splash can hold until the app is fully
// populated (no flash on first paint or first tab visit). `prefetchQuery` swallows
// its own errors, so a failing read resolves rather than rejecting — one bad query
// can't trap the splash. Safe to call repeatedly — it no-ops while data is fresh.
export async function prefetchHome(userId: string, role: Role): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  const warm = (queryKey: unknown[], queryFn: () => Promise<unknown>) =>
    jobs.push(queryClient.prefetchQuery({ queryKey, queryFn }));
  // The notification feed + unread badge live in the home header for every role.
  warm(['notifications', userId], () => listNotifications());
  warm(['notifications-unread', userId], () => getUnreadCount());
  // The chat list (last message + unread per conversation) — both roles have a Chat tab.
  warm(['conversation-previews'], () => listConversationPreviews());
  if (role === 'client') {
    const today = todayLocalDate();
    warm(['my-name', userId], () => getMyName(userId));
    warm(['streak', userId], () => getStreak(userId));
    warm(['my-coach', userId], () => getMyCoach(userId));
    warm(['athlete-profile', userId], () => getMyAthleteProfile(userId));
    warm(['nutrition-targets', userId], () => getTargets(userId));
    warm(['daily-nutrition', userId, today], () => getDailyNutrition(userId, today));
    warm(['today-workout', userId], () => fetchTodayWorkout(userId));
    warm(['plans-for-client', userId], () => listPlansForClient(userId));
    warm(['nutrition-day', userId, today], () => fetchNutritionDay(userId, today));
    warm(['progress-data', userId], () => fetchProgressData(userId));
    warm(['my-league-standing', userId], () => getMyLeagueStanding(userId)); // Home league CTA
  } else if (role === 'coach') {
    warm(['my-name', userId], () => getMyName(userId));
    warm(['my-clients'], () => listMyClients());
    warm(['my-invitations'], () => listMyInvitations());
    warm(['coach-board'], () => getBodyMetricsBoard());
    warm(['coach-leaderboard'], () => fetchCoachLeaderboard());
    warm(['coach-adherence'], () => getAdherenceOverview());
    warm(['coach-plan-effectiveness'], () => getPlanEffectiveness());
    warm(['analytics-insight'], () => getAnalyticsInsight());
  }
  await Promise.allSettled(jobs);
}
