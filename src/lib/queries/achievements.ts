// Query hooks for system-minted trophies (Engagement E1). The owner reads their own rows
// directly (RLS scopes app_achievements to user_id = auth.uid()); other users' trophies come
// through the field-allowlist RPC get_public_app_achievements (0073), which is consent-gated
// (public profile + share_body_metrics_publicly for body-derived keys). Mirrors the thin
// lib-fn + cached-hook shape of src/lib/queries/leaderboards.ts.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { EarnedAchievement } from '@/lib/achievements';

/** The signed-in user's own earned trophies (newest first). RLS returns only their rows. */
async function listMyAchievements(): Promise<EarnedAchievement[]> {
  const { data, error } = await supabase
    .from('app_achievements')
    .select('achievement_key, awarded_at, metadata')
    .order('awarded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as EarnedAchievement[];
}

/** Another user's PUBLIC trophies (consent-gated server-side). Empty when not public. */
async function listPublicAchievements(userId: string): Promise<EarnedAchievement[]> {
  const { data, error } = await supabase.rpc('get_public_app_achievements', { p_user_id: userId });
  if (error) throw error;
  return (data ?? []) as EarnedAchievement[];
}

export function useMyAchievements(userId?: string) {
  return useQuery({
    queryKey: ['my-achievements', userId],
    queryFn: listMyAchievements,
    enabled: !!userId,
  });
}

export function usePublicAchievements(userId?: string) {
  return useQuery({
    queryKey: ['public-achievements', userId],
    queryFn: () => listPublicAchievements(userId!),
    enabled: !!userId,
  });
}
