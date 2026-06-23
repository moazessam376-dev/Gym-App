// account-delete — a user erases their OWN account (PDPL right-to-erasure).
//
// Server-side only (§2): identity comes from the verified JWT (the caller can only
// ever delete themselves — `caller.id`, never a client-supplied id). Steps:
//   1. Verify the caller.
//   2. Remove their private storage objects (progress photos, InBody scans). The
//      `media` ROWS cascade when the profile is deleted, but the stored FILES do not —
//      so we delete them explicitly for a real erasure (§7 sensitive health data).
//   3. auth.admin.deleteUser(caller.id) — cascades every table FK'd to profiles
//      `on delete cascade` (progress_entries, body_metrics, media, food/workout logs,
//      messages, …). A coach's clients are NOT deleted: profiles.coach_id is
//      `on delete set null`, so they simply become unassigned.
//
// FORWARD-LOOKING (Phase 23 billing): financial rows must NEVER be hard-deleted
// (money.md). When `transactions` exists it must FK to profiles `on delete set null`
// (NOT cascade) and this function must anonymize payer_id/payee_id here instead of
// relying on the cascade. There is no such table yet, so nothing to anonymize today.
//
// Generic errors to the client; details server-side only (§4).
import { getCaller, serviceClient } from '../_shared/clients.ts';
import { corsHeaders, json } from '../_shared/http.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await getCaller(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  const svc = serviceClient();

  try {
    // 1. Delete the caller's stored files (rows cascade with the profile; bytes don't).
    const { data: media } = await svc
      .from('media')
      .select('bucket, path')
      .eq('owner_id', caller.id);
    if (media && media.length > 0) {
      // Group paths per bucket and remove in one call each.
      const byBucket = new Map<string, string[]>();
      for (const m of media as { bucket: string; path: string }[]) {
        const list = byBucket.get(m.bucket) ?? [];
        list.push(m.path);
        byBucket.set(m.bucket, list);
      }
      for (const [bucket, paths] of byBucket) {
        const { error: rmErr } = await svc.storage.from(bucket).remove(paths);
        // Non-fatal: log and continue to the auth-user delete (the rows still cascade);
        // a stray object is better than aborting the whole erasure.
        if (rmErr) console.error('account-delete storage remove failed', { bucket, message: rmErr.message });
      }
    }

    // 2. Delete the auth user → cascades all profile-owned rows.
    const { error: delErr } = await svc.auth.admin.deleteUser(caller.id);
    if (delErr) {
      console.error('account-delete admin.deleteUser failed', { message: delErr.message });
      return json({ error: 'server_error' }, 500);
    }

    return json({ status: 'deleted' }, 200);
  } catch (e) {
    console.error('account-delete error', { message: String(e) });
    return json({ error: 'server_error' }, 500);
  }
});
