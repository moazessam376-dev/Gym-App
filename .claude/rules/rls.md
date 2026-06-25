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

## Test gate
- The harness in `supabase/tests/rls/` MUST stay green (CLAUDE.md §11). Any new
  table needs: a cross-tenant denial test (expect 0 rows), an owner/coach positive
  control, and it is automatically covered by the "every public table has RLS
  enabled" invariant. A failing cross-tenant test is a build failure.
