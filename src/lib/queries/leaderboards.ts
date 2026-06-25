// Query hooks for the public leaderboards (Phase 20). Mirror src/lib/queries/profiles.ts:
// thin wrappers over the lib fns so cached values render instantly across remounts, with
// segment-scoped keys. These power the Top Athletes (per-sex) + Top Coaches boards and the
// athlete's own "league standing" Home CTA.
import { useQuery } from '@tanstack/react-query';
import { listTopAthletes, listTopCoaches } from '@/lib/leaderboards';
import { getMyLeagueStanding } from '@/lib/leagues';
import type { Sex } from '@/schemas/athlete-profile';

export function useTopAthletes(sex: Sex) {
  return useQuery({
    queryKey: ['top-athletes', sex],
    queryFn: () => listTopAthletes({ sex }),
  });
}

export function useTopCoaches() {
  return useQuery({
    queryKey: ['top-coaches'],
    queryFn: () => listTopCoaches(),
  });
}

export function useMyLeagueStanding(userId?: string) {
  return useQuery({
    queryKey: ['my-league-standing', userId],
    queryFn: () => getMyLeagueStanding(userId!),
    enabled: !!userId,
  });
}
