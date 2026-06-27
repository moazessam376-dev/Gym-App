// Data layer for the admin console (Slice G3). Dashboard counts + user search read the
// admin-gated SECURITY DEFINER RPCs (0054) — the admin fence is INSIDE the function
// (current_app_role()), so a non-admin gets an empty result, never an error. Ban / unban
// routes through the admin-set-ban Edge Function (the only client-immutable banned_at
// writer, §2). Reports / appeals stay in src/lib/moderation.ts.
import { supabase } from './supabase';

export type AdminCounts = {
  pending_applications: number;
  open_reports: number;
  open_appeals: number;
  coaches: number;
  clients: number;
  signups_7d: number;
};

export type AdminUser = {
  id: string;
  full_name: string | null;
  role: 'admin' | 'coach' | 'client';
  banned_at: string | null;
  created_at: string;
};

/** Dashboard counts (admin-only; returns null for a non-admin or before any data). */
export async function getAdminCounts(): Promise<AdminCounts | null> {
  const { data, error } = await supabase.rpc('admin_dashboard_counts');
  if (error) throw error;
  const row = (data ?? [])[0] as AdminCounts | undefined;
  return row ?? null;
}

/** Search users by name (admin-only). Empty/short query → recent users (RPC caps the limit). */
export async function searchUsers(query: string): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('admin_search_users', { p_query: query, p_limit: 50 });
  if (error) throw error;
  return (data ?? []) as AdminUser[];
}

/** Admin: ban / unban a user → admin-set-ban Edge fn (the only banned_at writer). */
export async function setUserBan(userId: string, banned: boolean): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-set-ban', { body: { user_id: userId, banned } });
  if (error) throw error;
}
