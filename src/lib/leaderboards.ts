// Public leaderboards data layer (Phase 20). The PUBLIC surface is reachable ONLY through
// the SECURITY DEFINER, field-allowlist RPCs in migration 0045 — never a raw table read
// (RLS is row-level, so the raw tables would leak every column of a row). The athlete RPC
// returns only the DERIVED FFMI index (never its weight/body-fat/height inputs, never sex);
// the coach RPC returns AGGREGATE counts only (never a client id). Audience is authenticated
// users only (no anon path). Mirrors src/lib/public-profiles.ts.
import { supabase } from './supabase';
import type { AthleteGoal, Sex } from '../schemas/athlete-profile';

export type AthleteBoardRow = {
  athlete_id: string;
  full_name: string | null;
  avatar_media_id: string | null;
  primary_goal: AthleteGoal | null;
  ffmi: number;
};

export type CoachBoardRow = {
  coach_id: string;
  full_name: string | null;
  avatar_media_id: string | null;
  improved_clients: number;
  tracked_clients: number;
};

/** Top athletes for one sex segment, FFMI-ranked (best first). Top 100. */
export async function listTopAthletes(opts: {
  sex: Sex;
  limit?: number;
  offset?: number;
}): Promise<AthleteBoardRow[]> {
  const { data, error } = await supabase.rpc('public_athlete_leaderboard', {
    p_sex: opts.sex,
    p_limit: opts.limit ?? 100,
    p_offset: opts.offset ?? 0,
  });
  if (error) throw error;
  // FFMI is a Postgres `numeric` → PostgREST returns it as a string; coerce to number.
  return (data ?? []).map((r: AthleteBoardRow & { ffmi: number | string }) => ({
    ...r,
    ffmi: Number(r.ffmi),
  })) as AthleteBoardRow[];
}

/** Top coaches by aggregate verified client outcomes (counts only). Top 100. */
export async function listTopCoaches(opts?: { limit?: number; offset?: number }): Promise<CoachBoardRow[]> {
  const { data, error } = await supabase.rpc('public_coach_leaderboard', {
    p_limit: opts?.limit ?? 100,
    p_offset: opts?.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as CoachBoardRow[];
}
