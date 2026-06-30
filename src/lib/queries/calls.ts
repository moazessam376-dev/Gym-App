// Query hooks for Calls & Meetings (Phase A). Thin cached wrappers over the lib fns so the
// booking sheet, the client calls list, the coach inbox/availability editor, and the
// incoming-call banner render instantly.
import { useQuery } from '@tanstack/react-query';
import {
  listCoachAvailability,
  listCoachBookedTimes,
  listCoachCallInbox,
  listCoachCalls,
  listCoachOpenSlots,
  listMyCalls,
  listMySlots,
} from '@/lib/calls';

/** Coach or their client: the coach's weekly working-hours windows. */
export function useCoachAvailability(enabled = true) {
  return useQuery({ queryKey: ['coach-availability'], queryFn: listCoachAvailability, enabled });
}

/** The coach's already-booked start-times (no client identity) — greys out taken times. */
export function useCoachBookedTimes(coachId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['coach-booked-times', coachId ?? null],
    queryFn: () => listCoachBookedTimes(coachId as string),
    enabled: enabled && !!coachId,
  });
}

/** Client: their coach's OPEN future slots (the booking sheet). */
export function useCoachOpenSlots(enabled = true) {
  return useQuery({ queryKey: ['coach-open-slots'], queryFn: listCoachOpenSlots, enabled });
}

/** Client: their own calls (upcoming + past). */
export function useMyCalls(enabled = true) {
  return useQuery({ queryKey: ['my-calls'], queryFn: listMyCalls, enabled });
}

/** Coach: all their published slots (availability editor). */
export function useMySlots(enabled = true) {
  return useQuery({ queryKey: ['my-slots'], queryFn: listMySlots, enabled });
}

/** Coach: their pending booking inbox. */
export function useCoachCallInbox(enabled = true) {
  return useQuery({ queryKey: ['coach-call-inbox'], queryFn: listCoachCallInbox, enabled });
}

/** Coach: all their calls (upcoming + past). */
export function useCoachCalls(enabled = true) {
  return useQuery({ queryKey: ['coach-calls'], queryFn: listCoachCalls, enabled });
}
