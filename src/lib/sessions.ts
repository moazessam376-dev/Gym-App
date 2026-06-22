// Data layer for completion logging (migration 0016). A CLIENT logs that they did
// a workout (a session) and the sets within it. Reads/writes go through RLS: a
// client owns their own rows; their coach can read them. The owner is set from
// auth.uid() (never client-supplied), and derived metrics that cross tenancy
// (leaderboard) go through the coach_leaderboard RPC, never a client aggregate.
import { supabase } from './supabase';
import {
  createSessionSchema,
  createSetLogSchema,
  updateSessionSchema,
  updateSetLogSchema,
  type CreateSession,
  type CreateSetLog,
  type SessionStatus,
  type UpdateSession,
  type UpdateSetLog,
} from '../schemas/session';

export type { SessionStatus } from '../schemas/session';

export type WorkoutSession = {
  id: string;
  user_id: string;
  plan_id: string | null;
  day_id: string | null;
  session_date: string; // 'YYYY-MM-DD'
  status: SessionStatus;
  completed_at: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ExerciseSetLog = {
  id: string;
  session_id: string;
  plan_exercise_id: string | null;
  exercise_name: string;
  set_index: number;
  reps_done: number | null;
  load_grams: number | null;
  is_completed: boolean;
  note: string | null;
};

export type SessionAdherence = {
  session_id: string;
  user_id: string;
  plan_id: string | null;
  day_id: string | null;
  session_date: string;
  status: SessionStatus;
  sets_done: number;
  sets_logged: number;
  sets_planned: number;
};

export type LeaderboardRow = {
  client_id: string;
  full_name: string | null;
  sessions_done: number;
  sets_done: number;
};

const SESSION_COLS =
  'id, user_id, plan_id, day_id, session_date, status, completed_at, note, created_at, updated_at';
const SET_COLS =
  'id, session_id, plan_exercise_id, exercise_name, set_index, reps_done, load_grams, is_completed, note';

/** Device-local calendar date as 'YYYY-MM-DD' (what the user perceives as "today"). */
export function todayLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO date for the start of the current week (Monday), used by the leaderboard. */
export function weekStartDate(d: Date = new Date()): string {
  const copy = new Date(d);
  const dow = (copy.getDay() + 6) % 7; // 0 = Monday
  copy.setDate(copy.getDate() - dow);
  return todayLocalDate(copy);
}

// ── Sessions ───────────────────────────────────────────────────────────────────

/** The signed-in client's own sessions (most recent first). RLS scopes to owner/coach. */
export async function listSessions(userId: string, limit = 60): Promise<WorkoutSession[]> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(SESSION_COLS)
    .eq('user_id', userId)
    .order('session_date', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WorkoutSession[];
}

/** The existing session for a planned day on a date, if the client already started it. */
export async function getSessionForDay(
  userId: string,
  dayId: string,
  date: string,
): Promise<WorkoutSession | null> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(SESSION_COLS)
    .eq('user_id', userId)
    .eq('day_id', dayId)
    .eq('session_date', date)
    .maybeSingle();
  if (error) throw error;
  return (data as WorkoutSession) ?? null;
}

/** Create a session OWNED by the signed-in client (user_id is forced from auth). */
export async function createSession(userId: string, input: CreateSession): Promise<WorkoutSession> {
  const v = createSessionSchema.parse(input);
  const { data, error } = await supabase
    .from('workout_sessions')
    .insert({
      user_id: userId,
      plan_id: v.plan_id ?? null,
      day_id: v.day_id ?? null,
      session_date: v.session_date ?? todayLocalDate(),
      status: v.status ?? 'in_progress',
      note: v.note ?? null,
    })
    .select(SESSION_COLS)
    .single();
  if (error) throw error;
  return data as WorkoutSession;
}

export async function updateSession(sessionId: string, input: UpdateSession): Promise<void> {
  const v = updateSessionSchema.parse(input);
  const { error } = await supabase.from('workout_sessions').update(v).eq('id', sessionId);
  if (error) throw error;
}

/** Mark a session complete (stamps completed_at). */
export async function completeSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('workout_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', sessionId);
  if (error) throw error;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('workout_sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

// ── Set logs ───────────────────────────────────────────────────────────────────

export async function listSetLogs(sessionId: string): Promise<ExerciseSetLog[]> {
  const { data, error } = await supabase
    .from('exercise_set_logs')
    .select(SET_COLS)
    .eq('session_id', sessionId)
    .order('set_index', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExerciseSetLog[];
}

export async function logSet(input: CreateSetLog): Promise<ExerciseSetLog> {
  const v = createSetLogSchema.parse(input);
  const { data, error } = await supabase
    .from('exercise_set_logs')
    .insert({
      session_id: v.session_id,
      plan_exercise_id: v.plan_exercise_id ?? null,
      exercise_name: v.exercise_name,
      set_index: v.set_index,
      reps_done: v.reps_done ?? null,
      load_grams: v.load_grams ?? null,
      is_completed: v.is_completed ?? true,
      note: v.note ?? null,
    })
    .select(SET_COLS)
    .single();
  if (error) throw error;
  return data as ExerciseSetLog;
}

export async function updateSetLog(setId: string, input: UpdateSetLog): Promise<void> {
  const v = updateSetLogSchema.parse(input);
  const { error } = await supabase.from('exercise_set_logs').update(v).eq('id', setId);
  if (error) throw error;
}

export async function deleteSetLog(setId: string): Promise<void> {
  const { error } = await supabase.from('exercise_set_logs').delete().eq('id', setId);
  if (error) throw error;
}

// ── Derived metrics ──────────────────────────────────────────────────────────

/** Adherence (sets done vs planned) for a session — from the tenant-safe view. */
export async function getAdherence(sessionId: string): Promise<SessionAdherence | null> {
  const { data, error } = await supabase
    .from('v_session_adherence')
    .select('session_id, user_id, plan_id, day_id, session_date, status, sets_done, sets_logged, sets_planned')
    .eq('session_id', sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // count(...) columns come back as bigint strings over the wire — coerce to number.
  return {
    ...(data as Record<string, unknown>),
    sets_done: Number((data as { sets_done: unknown }).sets_done),
    sets_logged: Number((data as { sets_logged: unknown }).sets_logged),
    sets_planned: Number((data as { sets_planned: unknown }).sets_planned),
  } as SessionAdherence;
}

/** Consecutive-day streak for a user (defaults to the caller). Tenant-safe via RLS. */
export async function getStreak(userId?: string): Promise<number> {
  const { data, error } = await supabase.rpc('current_streak', userId ? { p_user: userId } : {});
  if (error) throw error;
  return Number(data ?? 0);
}

/** Weekly leaderboard for the calling COACH's own clients only (server-fenced RPC). */
export async function getCoachLeaderboard(weekStart = weekStartDate()): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.rpc('coach_leaderboard', { p_week_start: weekStart });
  if (error) throw error;
  return (data ?? []) as LeaderboardRow[];
}

export type ExercisePR = {
  bestLoadGrams: number; // best weight (for the "best 60 kg" header)
  bestE1rmGrams: number; // best estimated 1RM — rewards more reps at the same load
  bestReps: number; // best reps (rep PR for bodyweight / unloaded sets)
};

/**
 * The athlete's all-time bests per exercise name, for PR detection (the 0021/0023
 * v_exercise_prs view). RLS-scoped: own as athlete, the client's as their coach.
 * Keyed by exercise_name (the snapshot stored on each set log).
 */
export async function getExercisePRs(userId: string): Promise<Map<string, ExercisePR>> {
  const { data, error } = await supabase
    .from('v_exercise_prs')
    .select('exercise_name, best_load_grams, best_e1rm_grams, best_reps')
    .eq('user_id', userId);
  if (error) throw error;
  const m = new Map<string, ExercisePR>();
  for (const r of (data ?? []) as {
    exercise_name: string;
    best_load_grams: number | string | null;
    best_e1rm_grams: number | string | null;
    best_reps: number | string | null;
  }[]) {
    m.set(r.exercise_name, {
      bestLoadGrams: Number(r.best_load_grams ?? 0),
      bestE1rmGrams: Number(r.best_e1rm_grams ?? 0),
      bestReps: Number(r.best_reps ?? 0),
    });
  }
  return m;
}

/** Epley estimated 1RM in integer grams: load × (30 + reps) / 30. 0 if unloaded. */
export function estimatedOneRepMaxGrams(loadGrams: number | null, reps: number | null): number {
  if (!loadGrams || loadGrams <= 0) return 0;
  const r = reps && reps > 0 ? reps : 1;
  return Math.round((loadGrams * (30 + r)) / 30);
}

// ── Per-exercise weight-unit preference (migration 0025) ─────────────────────

/** The athlete's per-exercise display-unit choices, keyed by exercise_name. */
export async function getExerciseUnits(userId: string): Promise<Map<string, 'kg' | 'lb'>> {
  const { data, error } = await supabase
    .from('exercise_unit_prefs')
    .select('exercise_name, unit')
    .eq('user_id', userId);
  if (error) throw error;
  const m = new Map<string, 'kg' | 'lb'>();
  for (const r of (data ?? []) as { exercise_name: string; unit: 'kg' | 'lb' }[]) {
    m.set(r.exercise_name, r.unit);
  }
  return m;
}

/** Persist the athlete's display unit for one exercise (by name). Upsert. */
export async function setExerciseUnit(
  userId: string,
  exerciseName: string,
  unit: 'kg' | 'lb',
): Promise<void> {
  const { error } = await supabase
    .from('exercise_unit_prefs')
    .upsert({ user_id: userId, exercise_name: exerciseName, unit }, { onConflict: 'user_id,exercise_name' });
  if (error) throw error;
}
