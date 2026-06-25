// Query hooks for the public-profile surface (Phase 19). Mirror src/lib/queries/home.ts:
// thin wrappers over the lib fns so cached values render instantly across remounts, with
// user/target-scoped keys so no cross-account bleed. These power the coach portfolio,
// the athlete public profile, and the Discover browse list.
import { useQuery } from '@tanstack/react-query';
import {
  getCoachPublicHighlights,
  getPublicAthleteProfile,
  getPublicCoachProfile,
  listPublicCoaches,
} from '@/lib/public-profiles';

export function usePublicCoachProfile(coachId?: string) {
  return useQuery({
    queryKey: ['public-coach-profile', coachId],
    queryFn: () => getPublicCoachProfile(coachId!),
    enabled: !!coachId,
  });
}

export function useCoachPublicHighlights(coachId?: string) {
  return useQuery({
    queryKey: ['coach-public-highlights', coachId],
    queryFn: () => getCoachPublicHighlights(coachId!),
    enabled: !!coachId,
  });
}

export function usePublicAthleteProfile(athleteId?: string) {
  return useQuery({
    queryKey: ['public-athlete-profile', athleteId],
    queryFn: () => getPublicAthleteProfile(athleteId!),
    enabled: !!athleteId,
  });
}

export function usePublicCoaches(specialty?: string | null) {
  return useQuery({
    queryKey: ['public-coaches', specialty ?? null],
    queryFn: () => listPublicCoaches({ specialty: specialty ?? null }),
  });
}
