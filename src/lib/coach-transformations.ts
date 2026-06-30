// Coach transformations — the WRITE side (the coach's curate editor). Reads/writes go
// through coach_transformations RLS (coach_id = auth.uid(), and a coach may only feature a
// client they actually coach via the WITH CHECK in 0077). The PUBLIC showcase read path is
// the separate get_coach_transformations RPC (src/lib/public-profiles.ts).
import { supabase } from './supabase';

export type MyTransformation = {
  id: string;
  client_id: string;
  caption: string | null;
  before_media_id: string | null;
  after_media_id: string | null;
  client_name: string | null;
};

/** A coach's clients who have consented to be featured (allow_transformation_sharing). */
export type ConsentingClient = { user_id: string; full_name: string | null; avatar_media_id: string | null };

// PostgREST returns a to-one embed as a single object at runtime, but supabase-js types it
// as an array — normalize either shape to the object (or null).
function one<T>(embed: T | T[] | null | undefined): T | null {
  if (embed == null) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/** The coach's own transformation rows + the featured client's display name. */
export async function listMyTransformations(coachId: string): Promise<MyTransformation[]> {
  const { data, error } = await supabase
    .from('coach_transformations')
    .select('id, client_id, caption, before_media_id, after_media_id, client:profiles!client_id(full_name)')
    .eq('coach_id', coachId)
    .order('featured_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    const client = one<{ full_name: string | null }>(r.client);
    return {
      id: r.id,
      client_id: r.client_id,
      caption: r.caption,
      before_media_id: r.before_media_id,
      after_media_id: r.after_media_id,
      client_name: client?.full_name ?? null,
    };
  });
}

/** The coach's clients who opted in to transformation sharing. */
export async function listConsentingClients(coachId: string): Promise<ConsentingClient[]> {
  const { data, error } = await supabase
    .from('athlete_profile')
    .select('user_id, allow_transformation_sharing, profile:profiles!user_id(full_name, avatar_media_id, coach_id)')
    .eq('allow_transformation_sharing', true);
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({ user_id: r.user_id as string, profile: one<{ full_name: string | null; avatar_media_id: string | null; coach_id: string | null }>(r.profile) }))
    .filter((r) => r.profile?.coach_id === coachId)
    .map((r) => ({ user_id: r.user_id, full_name: r.profile?.full_name ?? null, avatar_media_id: r.profile?.avatar_media_id ?? null }));
}

/** Create or update (one per coach+client) a featured transformation. */
export async function upsertTransformation(input: {
  coachId: string;
  clientId: string;
  caption: string | null;
  beforeMediaId: string | null;
  afterMediaId: string | null;
}): Promise<void> {
  const { error } = await supabase.from('coach_transformations').upsert(
    {
      coach_id: input.coachId,
      client_id: input.clientId,
      caption: input.caption,
      before_media_id: input.beforeMediaId,
      after_media_id: input.afterMediaId,
      featured_at: new Date().toISOString(),
    },
    { onConflict: 'coach_id,client_id' },
  );
  if (error) throw error;
}

export async function deleteTransformation(id: string): Promise<void> {
  const { error } = await supabase.from('coach_transformations').delete().eq('id', id);
  if (error) throw error;
}
