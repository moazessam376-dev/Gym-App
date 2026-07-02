// Query hooks for the Transformation Manager (0087). Thin cached wrappers over the lib fns
// so the mobile manager, the desktop portal view, the client builder, and the sidebar
// pending badge all share one cache. Keys REUSE the strings the screens already used
// inline (pre-0087), so nothing else churns.
import { useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/query';
import { listMyTransformations, listConsentingClients } from '@/lib/coach-transformations';
import { listPendingSubmissions, listMySubmissions } from '@/lib/transformation-submissions';
import { getCoachTransformations, getAthleteTransformations } from '@/lib/public-profiles';

/** Coach: raw editable card rows (the write-side shape, incl. photos + metric picks). */
export function useMyTransformations(coachId: string | null | undefined) {
  return useQuery({
    queryKey: ['my-transformations', coachId],
    queryFn: () => listMyTransformations(coachId as string),
    enabled: !!coachId,
  });
}

/** Coach: the rendered branded-card shape (what the public showcase shows). */
export function useCoachTransformationCards(coachId: string | null | undefined) {
  return useQuery({
    queryKey: ['coach-transformations', coachId],
    queryFn: () => getCoachTransformations(coachId as string),
    enabled: !!coachId,
  });
}

/** Coach: clients who consented to transformation sharing (the "feature a client" chips). */
export function useConsentingClients(coachId: string | null | undefined) {
  return useQuery({
    queryKey: ['consenting-clients', coachId],
    queryFn: () => listConsentingClients(coachId as string),
    enabled: !!coachId,
  });
}

/** Coach: pending client submissions (manager Pending tab + the sidebar badge). */
export function usePendingSubmissions(coachId: string | null | undefined) {
  return useQuery({
    queryKey: ['pending-transformation-submissions', coachId],
    queryFn: () => listPendingSubmissions(coachId as string),
    enabled: !!coachId,
  });
}

/** Client: their own submissions (any status). */
export function useMySubmissions(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ['my-transformation-submissions', clientId],
    queryFn: () => listMySubmissions(clientId as string),
    enabled: !!clientId,
  });
}

/** Client: their own featured card(s). */
export function useAthleteTransformations(athleteId: string | null | undefined) {
  return useQuery({
    queryKey: ['athlete-transformations', athleteId],
    queryFn: () => getAthleteTransformations(athleteId as string),
    enabled: !!athleteId,
  });
}

/** Invalidate every transformation surface for a user after any mutation (save / delete /
 *  approve / dismiss / submit). One helper so no screen hand-rolls a partial list. */
export async function invalidateTransformations(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['my-transformations', userId] }),
    queryClient.invalidateQueries({ queryKey: ['coach-transformations', userId] }),
    queryClient.invalidateQueries({ queryKey: ['consenting-clients', userId] }),
    queryClient.invalidateQueries({ queryKey: ['pending-transformation-submissions', userId] }),
    queryClient.invalidateQueries({ queryKey: ['my-transformation-submissions', userId] }),
    queryClient.invalidateQueries({ queryKey: ['athlete-transformations', userId] }),
  ]);
}
