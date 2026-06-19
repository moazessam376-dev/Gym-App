# Phase 2 — Coach ⇄ Client core

Maps to CLAUDE.md §2 (tenancy; ownership writes are server-side only). Depends on
Phase 1. **Not yet implemented** — this is the spec.

## Goal
A coach has a roster of clients. Clients are linked to a coach via
`profiles.coach_id`, but that link is **only ever written server-side** — never by
the client, never by the coach directly mutating another user's row.

## Scope
1. **Coach roster (read)**
   - Coach screen lists their clients. Reuses the existing `profiles` SELECT policy
     (`is_coach_of(id)`), so no schema change is needed for read.

2. **Client assignment (server-side write)**
   - An **Edge Function** (service role) sets `client.coach_id = <coach>` after
     validating the request with Zod. The client/coach apps never write `coach_id`
     directly — the Phase 0 immutability trigger already blocks that.
   - Capacity/seat checks are server-side truth (forward-looks to §6 payments:
     a coach's seat limit will gate assignment once billing is live).

3. **Invitations**
   - `invitations` table: `id`, `coach_id`, `email` (or code), `status`
     (`pending|accepted|revoked|expired`), `expires_at` (UTC), `created_at`.
   - RLS: a coach sees/creates only their own invitations; the invitee resolves a
     token via an Edge Function (service role), which performs the assignment.
   - Migration `0004_invitations.sql` ships the table **with** its RLS policies.
   - Tokens are single-use, time-boxed; never expose another coach's invitations.

## Data / schema
- `invitations` (with RLS). No change to `profiles` columns; assignment reuses
  `coach_id`. All timestamps `timestamptz` (UTC).
- Zod schemas: `createInvitation`, `acceptInvitation`, `assignClient` — allowlist
  fields only (§4).

## Edge Functions
- `assign-client` and `accept-invitation` run with the service role, validate
  input (Zod), enforce that the actor is the owning coach (from the verified JWT),
  and are the *only* writers of `coach_id` / invitation status. Return generic
  errors; log details server-side (§4).

## Acceptance / tests
- Harness adds: coach A can read only their roster; coach A cannot assign a client
  to coach B; a client cannot set/alter `coach_id` by any path; invitation rows are
  coach-scoped; an accepted invitation results in exactly one assignment.
- Manual: coach invites by email → invitee accepts → appears in roster; revoked /
  expired tokens are rejected.

## Out of scope
Plans/programs (Phase 3), uploads (Phase 4), chat (Phase 5), billing/seat
enforcement going live (Phase 6 — designed for, not enabled here).
