// Data layer for the Phase 2 coach ⇄ client flows.
//
// Reads go straight through RLS (a coach sees only their own clients /
// invitations). The two privileged writes — assigning coach_id and flipping an
// invitation's status — are NOT here: they live in the accept-invitation /
// assign-client Edge Functions (CLAUDE.md §2). Creating an invitation IS a
// client-side insert, explicitly allowed by the invitations RLS INSERT policy
// (coach creates their own pending row). Inputs are validated with the shared
// Zod schemas before any call (§4).
import { supabase } from './supabase';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  type AcceptInvitation,
  type CreateInvitation,
} from '../schemas/invitation';

export type Client = {
  id: string;
  full_name: string | null;
};

export type Invitation = {
  id: string;
  email: string;
  token: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  created_at: string;
  expires_at: string;
};

/** The coach's roster. RLS (`is_coach_of`) returns only this coach's clients. */
export async function listMyClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'client')
    .order('full_name', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/** The coach's own invitations (RLS scopes to coach_id = auth.uid()). */
export async function listMyInvitations(): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, token, status, created_at, expires_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Invitation[];
}

/**
 * Create a pending invitation. Only `email` is caller-supplied; token, status,
 * expiry come from DB defaults. The RLS INSERT policy enforces coach_id =
 * auth.uid() and a 'coach' role claim, so this can't forge another coach's invite.
 */
export async function createInvitation(
  coachId: string,
  input: CreateInvitation,
): Promise<Invitation> {
  const { email } = createInvitationSchema.parse(input);
  const { data, error } = await supabase
    .from('invitations')
    .insert({ coach_id: coachId, email })
    .select('id, email, token, status, created_at, expires_at')
    .single();
  if (error) throw error;
  return data as Invitation;
}

/**
 * Redeem an invitation token. Routed through the accept-invitation Edge Function
 * (the only writer of coach_id / status). The user's bearer token is attached
 * automatically by supabase-js, so the server resolves the accepting user from
 * the verified JWT — never from the request body.
 */
export async function acceptInvitation(input: AcceptInvitation): Promise<void> {
  const { token } = acceptInvitationSchema.parse(input);
  const { error } = await supabase.functions.invoke('accept-invitation', {
    body: { token },
  });
  if (error) throw error;
}
