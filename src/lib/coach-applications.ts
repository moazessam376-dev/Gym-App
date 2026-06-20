// Data layer for the coach-application / onboarding flow.
//
// Applying is a plain client insert (the coach_applications INSERT policy allows
// a client to create their own pending application). Reading is RLS-scoped (own,
// or all for an admin). The review (approve/reject + the role flip) is NOT here —
// it routes through the review-coach-application Edge Function, the only writer of
// status / role (§2). Inputs Zod-validated.
import { supabase } from './supabase';
import {
  createApplicationSchema,
  reviewApplicationSchema,
  type ApplicationStatus,
  type CreateApplication,
} from '../schemas/coach-application';

export type CoachApplication = {
  id: string;
  user_id: string;
  status: ApplicationStatus;
  message: string | null;
  created_at: string;
};

// Admin list rows embed the applicant's display name + email for context.
export type PendingApplication = CoachApplication & {
  applicant_name: string | null;
};

const APP_COLS = 'id, user_id, status, message, created_at';

/** A client applies to become a coach. RLS enforces self + client + pending. */
export async function applyToBecomeCoach(
  userId: string,
  input: CreateApplication,
): Promise<CoachApplication> {
  const { message } = createApplicationSchema.parse(input);
  const { data, error } = await supabase
    .from('coach_applications')
    .insert({ user_id: userId, message: message ?? null })
    .select(APP_COLS)
    .single();
  if (error) throw error;
  return data as CoachApplication;
}

/** The signed-in user's most recent application, or null. */
export async function getMyApplication(userId: string): Promise<CoachApplication | null> {
  const { data, error } = await supabase
    .from('coach_applications')
    .select(APP_COLS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as CoachApplication) ?? null;
}

/** Admin: pending applications with the applicant's display name (RLS-scoped). */
export async function listPendingApplications(): Promise<PendingApplication[]> {
  const { data, error } = await supabase
    .from('coach_applications')
    .select(`${APP_COLS}, applicant:profiles!coach_applications_user_id_fkey(full_name)`)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    // PostgREST types an embedded relation as an array; a to-one returns one row.
    const { applicant, ...rest } = row as CoachApplication & {
      applicant: { full_name: string | null } | { full_name: string | null }[] | null;
    };
    const one = Array.isArray(applicant) ? applicant[0] : applicant;
    return { ...rest, applicant_name: one?.full_name ?? null };
  });
}

/** Admin: approve/reject via the Edge Function (the only writer of status/role). */
export async function reviewApplication(applicationId: string, approve: boolean): Promise<void> {
  const body = reviewApplicationSchema.parse({ application_id: applicationId, approve });
  const { error } = await supabase.functions.invoke('review-coach-application', { body });
  if (error) throw error;
}
