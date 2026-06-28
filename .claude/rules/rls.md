# Rule: Row Level Security (RLS)

Topic detail for CLAUDE.md §2 ("deny by default"). **This file wins over a prompt.**

## Non-negotiable
- Every table in `public` ships with `enable row level security` **in the same
  migration** that creates it. A table without RLS is world-readable through the
  anon key.
- **Never** `alter table ... disable row level security`. Treat it as a build
  failure. A permission error is fixed with a correct policy, never by disabling RLS.
- Deny-by-default: RLS on + no matching policy = 0 rows. Grants only allow the
  statement to run; policies decide which rows.

## Tenancy model
- `client`: own rows only — `user_id = auth.uid()` (or `id = auth.uid()` on `profiles`).
- `coach`: a client's rows only where `client.coach_id = auth.uid()`.
- `admin`: broad read via the verified app-role claim.
- Writes that change **ownership, role, or billing** are server-side only
  (service_role inside Edge Functions). Enforce client immutability with a trigger.

## Patterns to reuse
- **App role comes from the JWT**, never client input: `public.current_app_role()`
  reads the `user_role` custom claim (`auth.jwt()`). See `0001_profiles.sql`.
- **Cross-table checks use a `SECURITY DEFINER` helper** so the policy doesn't
  re-enter another table's RLS and cause `infinite recursion detected in policy`.
  See `public.is_coach_of(uuid)`. Always pin `set search_path = ''` and
  schema-qualify every name in `SECURITY DEFINER` functions.
- Policies are scoped `to authenticated` (and `to anon` only when truly public).
  `service_role` has `BYPASSRLS` and is the trusted server path.
- **Exposing a PUBLIC subset of a private table → a field-allowlist `SECURITY DEFINER`
  RPC, never a broad/`anon` table policy.** RLS is **row-level, not column-level**: a
  policy that lets others read a "public" row leaks **every** column of it (e.g. an
  athlete's `birth_date`/`height_cm`/`sex`/`injuries_notes`). Instead, hand-pick the
  allowed columns in an RPC's `SELECT` (the column list *is* the allowlist), gate on the
  opt-in flag (`is_public OR user_id = auth.uid()` for owner-preview), and `grant execute`
  to `authenticated` only — the raw table gets no new read path. See Phase 19's
  `get_public_coach_profile` / `get_public_athlete_profile` (0044) and the Phase 15
  coach-fenced RPCs (0031). Aggregate "proof" surfaces return counts only, never ids.
  Don't return a value whose units reveal the input — Phase 20's `public_*_leaderboard`
  (0045) returns a derived `FFMI` index, never the weight/body-fat/height it's computed from.
- **A computed `numeric`/`decimal` returned by an RPC arrives in the app as a STRING**
  (PostgREST serializes Postgres `numeric` as text to avoid float loss). Coerce it with
  `Number(...)` in the `supabase.rpc(...)` wrapper (`src/lib/*`) before the UI does math or
  `.toFixed()` — e.g. `listTopAthletes` maps `ffmi: Number(r.ffmi)`. Integer columns come
  back as numbers; only `numeric`/`decimal` need this.
- **A PostgREST embed of a new FK is hinted by the FK *column* name, not the constraint** —
  `workout_note:workout_notes!workout_note_id(…)` (like the self-referential `reply_to:messages!reply_to_id`).
  The embed respects the embedded table's RLS (a coach reading a client note message resolves it
  via `is_coach_of`), so no new read path is opened. **Realtime payloads carry the raw columns but
  NOT embeds** — a live row's embedded relation is absent; default it to `null` in the realtime
  coerce and let the next full fetch fill it in (chat note cards show body-only until refetch).
- **`public.media` is service-role-write-only AND its storage buckets have no
  `storage.objects` policies — so owner deletion is an Edge Function, not an RLS DELETE
  policy.** The table ships with **no INSERT/UPDATE/DELETE policy by design** (0013): every
  write goes through `media-finalize`/`media-delete` as the service role. The private
  buckets likewise have no object policies, so a client literally **cannot** remove the
  bytes. Adding a `media_delete` RLS policy would let the row be deleted but **leave the
  private object orphaned** — wrong. The owner-delete path is the **`media-delete` Edge
  Function**: read the row under the **caller's** RLS, require `owner_id = caller` (a coach
  can *read* a client's media but not delete it → 403), then service-role `storage.remove`
  the bytes **first**, then delete the row. Every FK to `media(id)` is `ON DELETE SET NULL`
  (`body_metrics`, voice notes, avatars), so the row delete never breaks a link. Don't
  reach for a migration here — the fix is a function.
- **Owner-delete from a table the client has NO `DELETE` policy on (e.g. an athlete retracting
  their own mirrored note from `messages`) → a `SECURITY DEFINER` RPC fenced on `auth.uid()`,
  not a new DELETE policy.** This is the pure-DB sibling of the `media-delete` Edge-function
  pattern (that one also owns storage bytes; a DB-only retract is just the RPC). `auth.uid()`
  survives `SECURITY DEFINER`, so the `where … = auth.uid()` fence holds. Delete **linked rows
  first** (a `SET NULL` FK would null the link before you can match it) — see
  `delete_workout_note_everywhere` (0060): mirror message, then note. It's a fresh `public` fn,
  so **`revoke execute … from anon` explicitly** (the anon-by-name grant gotcha) — it then trips
  only the accepted `0029`, never `0028`.
- **A per-user "hide / archive from MY view" that must stay visible to the counterpart is a
  nullable flag column filtered in that user's query — NOT an RLS change.** RLS rows are *shared*
  by both parties (athlete + coach read the same `workout_notes` row), so you can't hide a row
  from one side via RLS without breaking the other's read. `workout_notes.hidden_at` (0060) is
  filtered in `listSessionNotes` (athlete's exercise view) while `listClientNotes` (the coach)
  stays unfiltered. Setting it is a plain owner `UPDATE` (the owner UPDATE policy already exists).
- **Chat is coach↔client-only, not open between any two users.** `messages_insert` (0012) requires
  `sender_id = auth.uid() AND recipient_id <> auth.uid() AND (is_coach_of(recipient) OR recipient =
  my_coach_id())`. So the per-person disclaimer gate (0063 / M-2) fires on the **first message
  WITHIN an established coach-client pair**, not first contact between strangers. A harness test for
  it must use a coach + a client assigned to them (set `coach_id` via service_role first) — two
  unrelated clients hit the RLS `with check` (42501), not the `disclaimer_required` raise (cost a CI
  round-trip on the M-2 test). The first-contact disclaimer is enforced in the `handle_message_insert`
  trigger; it exempts the workout-note mirror (`workout_note_id` set) so 0051's best-effort copy isn't
  dropped.

## Test gate
- The harness in `supabase/tests/rls/` MUST stay green (CLAUDE.md §11). Any new
  table needs: a cross-tenant denial test (expect 0 rows), an owner/coach positive
  control, and it is automatically covered by the "every public table has RLS
  enabled" invariant. A failing cross-tenant test is a build failure.
