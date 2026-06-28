// Public profiles data layer (Phase 19). The PUBLIC surface is reachable ONLY through
// the SECURITY DEFINER, field-allowlist RPCs in migration 0044 — never a raw table read
// (RLS is row-level, so the raw tables would leak every column of a public row). Each
// RPC returns 0 rows unless the target opted in (is_public), and the column list IS the
// allowlist: the athlete RPC, by construction, can never return birth_date/height/sex/
// injuries. Audience is authenticated users only in V1 (no anon path).
import { supabase } from './supabase';
import type { AthleteGoal } from '../schemas/athlete-profile';
import type { Specialty } from '../schemas/coach-profile';

export type PublicCoachProfile = {
  coach_id: string;
  full_name: string | null;
  handle: string | null;
  avatar_media_id: string | null;
  bio: string | null;
  specialties: Specialty[];
  years_experience: number | null;
  certifications: string | null;
  achievements: string[];
};

export type PublicAthleteProfile = {
  athlete_id: string;
  full_name: string | null;
  handle: string | null;
  avatar_media_id: string | null;
  primary_goal: AthleteGoal | null;
  public_achievements: string[];
};

export type PublicCoachListItem = {
  coach_id: string;
  full_name: string | null;
  handle: string | null;
  avatar_media_id: string | null;
  specialties: Specialty[];
  years_experience: number | null;
  bio: string | null;
  // Anonymized outcome proof (U-4): clients with ≥2 verified readings, and how many improved.
  tracked_clients: number;
  improved_clients: number;
};

// Aggregate, ANONYMIZED proof for a coach's public page. One row per goal category the
// coach trains — counts only, never a client id/name (the RPC has no such column).
export type CoachHighlight = {
  primary_goal: AthleteGoal | 'unspecified';
  client_count: number;
  with_progress: number; // clients with ≥2 verified body-comp readings
  improved: number; // of those, how many trended in a healthy direction
};

/** A public coach portfolio (null if the coach isn't public / doesn't exist). */
export async function getPublicCoachProfile(coachId: string): Promise<PublicCoachProfile | null> {
  const { data, error } = await supabase.rpc('get_public_coach_profile', { p_coach_id: coachId });
  if (error) throw error;
  return ((data ?? [])[0] as PublicCoachProfile) ?? null;
}

/** A public athlete profile — minimal allowlist (null if not public). */
export async function getPublicAthleteProfile(athleteId: string): Promise<PublicAthleteProfile | null> {
  const { data, error } = await supabase.rpc('get_public_athlete_profile', { p_athlete_id: athleteId });
  if (error) throw error;
  return ((data ?? [])[0] as PublicAthleteProfile) ?? null;
}

/** Browse public coaches (optional case-insensitive specialty filter), paginated. */
export async function listPublicCoaches(opts?: {
  specialty?: string | null;
  limit?: number;
  offset?: number;
}): Promise<PublicCoachListItem[]> {
  const { data, error } = await supabase.rpc('list_public_coaches', {
    p_specialty: opts?.specialty ?? null,
    p_limit: opts?.limit ?? 50,
    p_offset: opts?.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as PublicCoachListItem[];
}

/** Aggregate, anonymized "goals I help achieve" proof for a public coach. */
export async function getCoachPublicHighlights(coachId: string): Promise<CoachHighlight[]> {
  const { data, error } = await supabase.rpc('coach_public_highlights', { p_coach_id: coachId });
  if (error) throw error;
  return (data ?? []) as CoachHighlight[];
}
