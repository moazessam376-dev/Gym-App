// Query hooks for the "request a coach" funnel (Slice G2). Thin wrappers over the lib fns
// so cached values render instantly. listMyCoachRequests powers the coach-profile CTA
// state; listIncomingCoachRequests powers the coach inbox.
import { useQuery } from '@tanstack/react-query';
import { listIncomingCoachRequests, listMyCoachRequests } from '@/lib/coach-requests';

export function useMyCoachRequests(enabled = true) {
  return useQuery({
    queryKey: ['my-coach-requests'],
    queryFn: listMyCoachRequests,
    enabled,
  });
}

export function useIncomingCoachRequests(enabled = true) {
  return useQuery({
    queryKey: ['incoming-coach-requests'],
    queryFn: listIncomingCoachRequests,
    enabled,
  });
}
