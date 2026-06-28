// Data layer for an athlete's goals/profile (migration 0017). Owner-scoped via
// RLS: a client reads/writes their own; their coach reads it (to tailor plans).
// user_id is forced from the caller — never client-supplied. Reads by later
// pillars (macro targets, progress, ranks) go through getAthleteProfileFor.
import { supabase } from './supabase';
import {
  activeTrainingPlanIdSchema,
  upsertAthleteProfileSchema,
  weightUnitSchema,
  type ActivityLevel,
  type AthleteGoal,
  type DietaryTag,
  type ExperienceLevel,
  type Sex,
  type UpsertAthleteProfile,
  type WeightUnit,
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
  weight_unit: WeightUnit;
  is_public: boolean;
  public_achievements: string[];
  leaderboard_opt_in: boolean;
  share_body_metrics_publicly: boolean;
  allow_transformation_sharing: boolean;
  active_training_plan_id: string | null;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

const COLS =
  'user_id, primary_goal, experience_level, sex, birth_date, height_cm, target_weight_grams, activity_level, training_days, dietary_tags, injuries_notes, weight_unit, is_public, public_achievements, leaderboard_opt_in, share_body_metrics_publicly, allow_transformation_sharing, active_training_plan_id, onboarded_at, created_at, updated_at';

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

/**
 * Persist the athlete's preferred display unit (kg/lb). Upserts so it works even
 * before the questionnaire has created a profile row. Only this one column is
 * written — the partial upsert leaves the rest of the profile untouched.
 */
export async function setWeightUnit(userId: string, unit: WeightUnit): Promise<void> {
  const v = weightUnitSchema.parse(unit);
  const { error } = await supabase
    .from('athlete_profile')
    .upsert({ user_id: userId, weight_unit: v }, { onConflict: 'user_id' });
  if (error) throw error;
}

/**
 * Choose which assigned training plan drives the Home "today" ring (or null to fall
 * back to the newest plan). Focused partial upsert — only this column is written, so
 * it works before the questionnaire has created a profile row. RLS forces it to the
 * caller's own row; the app only ever passes a plan the client actually has.
 */
export async function setActiveTrainingPlan(userId: string, planId: string | null): Promise<void> {
  const v = activeTrainingPlanIdSchema.parse(planId);
  const { error } = await supabase
    .from('athlete_profile')
    .upsert({ user_id: userId, active_training_plan_id: v }, { onConflict: 'user_id' });
  if (error) throw error;
}

/**
 * Toggle the athlete's public profile on/off, the leaderboard opt-in (Phase 20),
 * and/or update public achievements (Phase 19). Focused partial upsert; allowlisted
 * fields only (§4). The PUBLIC read path never exposes the sensitive profile fields —
 * only name/avatar/goal/these (and a derived FFMI index on the board, never its inputs).
 */
export async function setAthleteVisibility(
  userId: string,
  input: {
    is_public?: boolean;
    public_achievements?: string[];
    leaderboard_opt_in?: boolean;
    share_body_metrics_publicly?: boolean;
    allow_transformation_sharing?: boolean;
  },
): Promise<void> {
  const v = upsertAthleteProfileSchema.parse(input);
  const { error } = await supabase
    .from('athlete_profile')
    .upsert({ user_id: userId, ...v }, { onConflict: 'user_id' });
  if (error) throw error;
}
