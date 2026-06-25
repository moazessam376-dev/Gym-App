// Data layer for a coach's profile (migration 0017). Owner-scoped via RLS: a
// coach reads/writes their own; their clients may read it (my_coach_id).
import { supabase } from './supabase';
import { upsertCoachProfileSchema, type Specialty, type UpsertCoachProfile } from '../schemas/coach-profile';

export type CoachProfile = {
  user_id: string;
  bio: string | null;
  specialties: Specialty[];
  years_experience: number | null;
  certifications: string | null;
  is_public: boolean;
  achievements: string[];
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
};

const COLS =
  'user_id, bio, specialties, years_experience, certifications, is_public, achievements, onboarded_at, created_at, updated_at';

/** The signed-in coach's own profile (null if not started). */
export async function getMyCoachProfile(userId: string): Promise<CoachProfile | null> {
  const { data, error } = await supabase.from('coach_profile').select(COLS).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return (data as CoachProfile) ?? null;
}

/** A coach's profile, for one of their clients (RLS via my_coach_id). */
export async function getCoachProfileFor(coachId: string): Promise<CoachProfile | null> {
  const { data, error } = await supabase.from('coach_profile').select(COLS).eq('user_id', coachId).maybeSingle();
  if (error) throw error;
  return (data as CoachProfile) ?? null;
}

/** Create or update the caller's own coach profile. Allowlisted fields only (§4). */
export async function upsertCoachProfile(userId: string, input: UpsertCoachProfile): Promise<CoachProfile> {
  const v = upsertCoachProfileSchema.parse(input);
  const existing = await getMyCoachProfile(userId);
  const onboarded = existing?.onboarded_at ?? new Date().toISOString();
  const { data, error } = await supabase
    .from('coach_profile')
    .upsert({ user_id: userId, ...v, onboarded_at: onboarded }, { onConflict: 'user_id' })
    .select(COLS)
    .single();
  if (error) throw error;
  return data as CoachProfile;
}

/**
 * Toggle the coach's public portfolio on/off and/or update achievements (Phase 19).
 * A focused partial upsert (like setWeightUnit) so it doesn't require re-sending the
 * whole profile. Allowlisted fields only (§4); user_id is forced by the upsert key + RLS.
 */
export async function setCoachVisibility(
  userId: string,
  input: { is_public?: boolean; achievements?: string[] },
): Promise<void> {
  const v = upsertCoachProfileSchema.parse(input);
  const { error } = await supabase
    .from('coach_profile')
    .upsert({ user_id: userId, ...v }, { onConflict: 'user_id' });
  if (error) throw error;
}
