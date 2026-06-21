// Data layer for an athlete's goals/profile (migration 0017). Owner-scoped via
// RLS: a client reads/writes their own; their coach reads it (to tailor plans).
// user_id is forced from the caller — never client-supplied. Reads by later
// pillars (macro targets, progress, ranks) go through getAthleteProfileFor.
import { supabase } from './supabase';
import {
  upsertAthleteProfileSchema,
  type ActivityLevel,
  type AthleteGoal,
  type DietaryTag,
  type ExperienceLevel,
  type Sex,
  type UpsertAthleteProfile,
} from '../schemas/athlete-profile';

export type AthleteProfile = {
  user_id: string;
  primary_goal: AthleteGoal | null;
  experience_level: ExperienceLevel | null;
  sex: Sex | null;
  birth_date: string | null;
  height_cm: number | null;
  target_weight_grams: number | null;
  activity_level: ActivityLevel | null;
  training_days: number | null;
  dietary_tags: DietaryTag[];
  injuries_notes: string | null;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

const COLS =
  'user_id, primary_goal, experience_level, sex, birth_date, height_cm, target_weight_grams, activity_level, training_days, dietary_tags, injuries_notes, onboarded_at, created_at, updated_at';

/** The signed-in client's own profile (null if not started). */
export async function getMyAthleteProfile(userId: string): Promise<AthleteProfile | null> {
  const { data, error } = await supabase.from('athlete_profile').select(COLS).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data as AthleteProfile) ?? null;
}

/** A client's profile, for their coach (RLS lets a coach read their clients'). */
export async function getAthleteProfileFor(clientId: string): Promise<AthleteProfile | null> {
  const { data, error } = await supabase.from('athlete_profile').select(COLS).eq('user_id', clientId).maybeSingle();
  if (error) throw error;
  return (data as AthleteProfile) ?? null;
}

/**
 * Create or update the caller's own profile. Allowlisted fields only (§4); the
 * server forces user_id = auth.uid() via the upsert key + RLS. Stamps
 * onboarded_at on the first save that has at least a primary goal.
 */
export async function upsertAthleteProfile(userId: string, input: UpsertAthleteProfile): Promise<AthleteProfile> {
  const v = upsertAthleteProfileSchema.parse(input);
  const existing = await getMyAthleteProfile(userId);
  const onboarded = existing?.onboarded_at ?? (v.primary_goal ? new Date().toISOString() : null);
  const { data, error } = await supabase
    .from('athlete_profile')
    .upsert({ user_id: userId, ...v, onboarded_at: onboarded }, { onConflict: 'user_id' })
    .select(COLS)
    .single();
  if (error) throw error;
  return data as AthleteProfile;
}
