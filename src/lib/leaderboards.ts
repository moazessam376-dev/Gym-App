// Public leaderboards data layer (Phase 20). The PUBLIC surface is reachable ONLY through
// the SECURITY DEFINER, field-allowlist RPCs in migration 0045 — never a raw table read
// (RLS is row-level, so the raw tables would leak every column of a row). The athlete RPC
// returns only the DERIVED FFMI index (never its weight/body-fat/height inputs, never sex);
// the coach RPC returns AGGREGATE counts only (never a client id). Audience is authenticated
// users only (no anon path). Mirrors src/lib/public-profiles.ts.
import { supabase } from './supabase';
import type { AthleteGoal, Sex } from '../schemas/athlete-profile';

// The board period (0052): 'all' = latest-ever reading (original behavior); 'month'/'quarter'
// rank only athletes whose latest VERIFIED reading falls inside the trailing 30 / 90 days.
export type LeaderboardPeriod = 'all' | 'month' | 'quarter';

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

/** The signed-in athlete's OWN standing on the board: exact rank + board size + FFMI. */
export type MyAthleteRank = {
  rank: number;
  total: number;
  ffmi: number;
};

/** Top athletes for one sex segment + period, FFMI-ranked (best first). Top 100. */
export async function listTopAthletes(opts: {
  sex: Sex;
  period?: LeaderboardPeriod;
  limit?: number;
  offset?: number;
}): Promise<AthleteBoardRow[]> {
  const { data, error } = await supabase.rpc('public_athlete_leaderboard', {
    p_period: opts.period ?? 'all',
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

/** Top coaches by aggregate verified client outcomes for a period (counts only). Top 100. */
export async function listTopCoaches(opts?: {
  period?: LeaderboardPeriod;
  limit?: number;
  offset?: number;
}): Promise<CoachBoardRow[]> {
  const { data, error } = await supabase.rpc('public_coach_leaderboard', {
    p_period: opts?.period ?? 'all',
    p_limit: opts?.limit ?? 100,
    p_offset: opts?.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as CoachBoardRow[];
}

/**
 * The caller's own rank on the athlete board for a sex + period. Returns null when the
 * caller has no qualifying verified reading (the UI shows a "log a reading / opt in" nudge).
 * The RPC counts across the board server-side but returns ONLY the caller's own numbers.
 */
export async function getMyAthleteRank(sex: Sex, period: LeaderboardPeriod = 'all'): Promise<MyAthleteRank | null> {
  const { data, error } = await supabase.rpc('public_athlete_my_rank', { p_sex: sex, p_period: period });
  if (error) throw error;
  const row = (data ?? [])[0] as { rank: number | string; total: number | string; ffmi: number | string } | undefined;
  if (!row || row.rank == null) return null;
  // ffmi is `numeric` → string; rank/total are integers → numbers (coerce defensively).
  return { rank: Number(row.rank), total: Number(row.total), ffmi: Number(row.ffmi) };
}
