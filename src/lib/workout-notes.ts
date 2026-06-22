// Data layer for athlete → coach workout feedback (migration 0021). The athlete
// authors notes (user_id forced from auth.uid() by the DB trigger); their coach
// reads them via RLS (is_coach_of). Stored so we can surface them in chat later.
import { supabase } from './supabase';
import { createWorkoutNoteSchema, type CreateWorkoutNote, type NoteCategory } from '../schemas/workout-note';

export type { NoteCategory } from '../schemas/workout-note';

export type WorkoutNote = {
  id: string;
  user_id: string;
  session_id: string | null;
  plan_exercise_id: string | null;
  exercise_name: string | null;
  category: NoteCategory;
  body: string;
  created_at: string;
};

const COLS =
  'id, user_id, session_id, plan_exercise_id, exercise_name, category, body, created_at';

/** Create an athlete-authored note (user_id is forced server-side by the trigger). */
export async function createWorkoutNote(userId: string, input: CreateWorkoutNote): Promise<WorkoutNote> {
  const v = createWorkoutNoteSchema.parse(input);
  const { data, error } = await supabase
    .from('workout_notes')
    .insert({
      user_id: userId,
      session_id: v.session_id ?? null,
      plan_exercise_id: v.plan_exercise_id ?? null,
      exercise_name: v.exercise_name ?? null,
      category: v.category,
      body: v.body,
    })
    .select(COLS)
    .single();
  if (error) throw error;
  return data as WorkoutNote;
}

/** Notes attached to one session (athlete's own, or a coach reading their client's). */
export async function listSessionNotes(sessionId: string): Promise<WorkoutNote[]> {
  const { data, error } = await supabase
    .from('workout_notes')
    .select(COLS)
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkoutNote[];
}

/** Recent notes from one client, for their coach (RLS scopes to is_coach_of). */
export async function listClientNotes(clientId: string, limit = 20): Promise<WorkoutNote[]> {
  const { data, error } = await supabase
    .from('workout_notes')
    .select(COLS)
    .eq('user_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as WorkoutNote[];
}

export async function deleteWorkoutNote(id: string): Promise<void> {
  const { error } = await supabase.from('workout_notes').delete().eq('id', id);
  if (error) throw error;
}
