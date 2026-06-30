// Public profiles data layer (Phase 19). The PUBLIC surface is reachable ONLY through
// the SECURITY DEFINER, field-allowlist RPCs in migration 0044 — never a raw table read
// (RLS is row-level, so the raw tables would leak every column of a public row). Each
// RPC returns 0 rows unless the target opted in (is_public), and the column list IS the
// allowlist: the athlete RPC, by construction, can never return birth_date/height/sex/
// injuries. Audience is authenticated users only in V1 (no anon path).
import { supabase } from './supabase';
import type { AthleteGoal } from '../schemas/athlete-profile';
import type { Specialty } from '../schemas/coach-profile';
import type { TierId } from './leagues';

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
  // E3 enrichment
  coaching_philosophy: string | null;
  accepting_clients: boolean;
  featured_template_id: string | null;
  active_roster_count: number;
  median_goal_progress: number | null;
};

// A coach's curated before/after showcase card (consent-filtered, field-allowlist; E3).
export type CoachTransformation = {
  transformation_id: string;
  client_first_name: string | null;
  caption: string | null;
  before_media_id: string | null;
  after_media_id: string | null;
  duration_weeks: number | null;
  body_fat_delta_bp: number | null; // + = lost
  lean_mass_delta_grams: number | null; // + = gained
  ffmi_before: number | null;
  ffmi_after: number | null;
  tier_before: TierId | null;
  tier_after: TierId | null;
  goal: AthleteGoal | null;
};

export type AthleteTopPr = {
  exercise_name: string;
  best_load_grams: number | null;
  best_e1rm_grams: number | null;
  best_reps: number | null;
};

export type AthleteSeriesPoint = {
  measured_at: string;
  weight_grams: number | null;
  body_fat_bp: number | null;
};

// Enriched in E2 (0075). Identity + activity always present when public; the body-transformation
// fields are null unless the athlete opted in to share_body_metrics_publicly (or is the owner).
export type PublicAthleteProfile = {
  athlete_id: string;
  full_name: string | null;
  handle: string | null;
  avatar_media_id: string | null;
  primary_goal: AthleteGoal | null;
  public_achievements: string[];
  // activity
  current_streak: number;
  workouts_last_30d: number;
  training_days: number | null;
  top_prs: AthleteTopPr[];
  coach_id: string | null;
  coach_name: string | null;
  coach_avatar_media_id: string | null;
  // body transformation (null when not shared)
  share_body_metrics: boolean;
  has_transformation: boolean | null;
  baseline_at: string | null;
  latest_at: string | null;
  body_fat_delta_bp: number | null;
  lean_mass_delta_grams: number | null;
  ffmi_latest: number | null;
  ffmi_tier: TierId | null;
  target_weight_grams: number | null;
  latest_weight_grams: number | null;
  body_metrics_series: AthleteSeriesPoint[] | null;
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
  median_progress: number | null; // E3: median goal-progress score for this goal
};

/** A public coach portfolio (null if the coach isn't public / doesn't exist). */
export async function getPublicCoachProfile(coachId: string): Promise<PublicCoachProfile | null> {
  const { data, error } = await supabase.rpc('get_public_coach_profile', { p_coach_id: coachId });
  if (error) throw error;
  const row = (data ?? [])[0] as (PublicCoachProfile & { median_goal_progress: number | string | null }) | undefined;
  if (!row) return null;
  // median_goal_progress is a Postgres `numeric` → PostgREST returns it as a string; coerce.
  return { ...row, median_goal_progress: row.median_goal_progress == null ? null : Number(row.median_goal_progress) };
}

/** A coach's public transformations showcase (consent-filtered server-side; empty if none). */
export async function getCoachTransformations(coachId: string): Promise<CoachTransformation[]> {
  const { data, error } = await supabase.rpc('get_coach_transformations', { p_coach_id: coachId });
  if (error) throw error;
  // ffmi_before/after are numeric → strings; the integer deltas/weeks come back as numbers.
  return (data ?? []).map((r: CoachTransformation & { ffmi_before: number | string | null; ffmi_after: number | string | null }) => ({
    ...r,
    ffmi_before: r.ffmi_before == null ? null : Number(r.ffmi_before),
    ffmi_after: r.ffmi_after == null ? null : Number(r.ffmi_after),
  })) as CoachTransformation[];
}

/** A public athlete profile — field-allowlist + consent-gated (null if not public). */
export async function getPublicAthleteProfile(athleteId: string): Promise<PublicAthleteProfile | null> {
  const { data, error } = await supabase.rpc('get_public_athlete_profile', { p_athlete_id: athleteId });
  if (error) throw error;
  const row = (data ?? [])[0] as (PublicAthleteProfile & { ffmi_latest: number | string | null }) | undefined;
  if (!row) return null;
  // ffmi_latest is a Postgres `numeric` → PostgREST returns it as a string; coerce.
  return {
    ...row,
    ffmi_latest: row.ffmi_latest == null ? null : Number(row.ffmi_latest),
    top_prs: row.top_prs ?? [],
    body_metrics_series: row.body_metrics_series ?? null,
  };
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
  return (data ?? []).map((r: CoachHighlight & { median_progress: number | string | null }) => ({
    ...r,
    median_progress: r.median_progress == null ? null : Number(r.median_progress),
  })) as CoachHighlight[];
}
