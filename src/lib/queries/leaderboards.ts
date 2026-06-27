// Query hooks for the public leaderboards (Phase 20). Mirror src/lib/queries/profiles.ts:
// thin wrappers over the lib fns so cached values render instantly across remounts, with
// segment-scoped keys. These power the Top Athletes (per-sex) + Top Coaches boards and the
// athlete's own "league standing" Home CTA.
import { useQuery } from '@tanstack/react-query';
import { getMyAthleteRank, listTopAthletes, listTopCoaches, type LeaderboardPeriod } from '@/lib/leaderboards';
import { getMyLeagueStanding } from '@/lib/leagues';
import type { Sex } from '@/schemas/athlete-profile';

export function useTopAthletes(sex: Sex, period: LeaderboardPeriod = 'all') {
  return useQuery({
    queryKey: ['top-athletes', sex, period],
    queryFn: () => listTopAthletes({ sex, period }),
  });
}

export function useTopCoaches(period: LeaderboardPeriod = 'all') {
  return useQuery({
    queryKey: ['top-coaches', period],
    queryFn: () => listTopCoaches({ period }),
  });
}

export function useMyAthleteRank(sex: Sex | null | undefined, period: LeaderboardPeriod = 'all') {
  return useQuery({
    queryKey: ['my-athlete-rank', sex, period],
    queryFn: () => getMyAthleteRank(sex!, period),
    enabled: !!sex,
  });
}

export function useMyLeagueStanding(userId?: string) {
  return useQuery({
    queryKey: ['my-league-standing', userId],
    queryFn: () => getMyLeagueStanding(userId!),
    enabled: !!userId,
  });
}
