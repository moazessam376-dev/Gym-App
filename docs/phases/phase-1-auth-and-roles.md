# Phase 1 — Auth & roles

Maps to CLAUDE.md §1 (roles, role-gated navigation) and §5 (auth & tokens).
Depends on Phase 0.

**Status: implemented (email/password).** Shipped: the `on_auth_user_created`
bootstrap trigger (`0003`), the `custom_access_token_hook` that injects `user_role`
(`0004`), an `AuthProvider` + sign-in/sign-up screens, and a role-gated router that
keeps signed-out users in the `(auth)` group. **Deferred to a follow-up:** Google
& Apple sign-in (they need provider credentials + a dev build for native), and
splitting the protected area into per-role route groups (begins in Phase 2).

## Goal
A user can sign up / sign in, gets a `profiles` row with a role, the role travels
in the verified JWT, and the app routes them to the right role-gated area.

## Scope
1. **Supabase Auth providers**
   - Email/password first. Then Google and Apple (Apple is required by App Store
     when any third-party sign-in is offered).
   - Use `supabase.auth` only — never hand-roll JWT verification (§5).
   - Sign-in/up/out screens under an unauthenticated route group.

2. **Token storage** — already wired in `src/lib/supabase.ts`: SecureStore on
   native, `localStorage` on web. Confirm refresh/persist behavior; never use
   AsyncStorage (§5).

3. **Profile bootstrap (server-side)**
   - Replace Phase 0's client self-insert with a **trigger or Edge Function on
     `auth.users` insert** that creates the `profiles` row with `role='client'`,
     `coach_id=null`. Ownership/role assignment stays server-side (§2).
   - Migration `0003_profile_bootstrap.sql` (+ harness update).

4. **Custom access-token hook (the key piece)**
   - Configure a Supabase **custom access-token hook** that injects
     `user_role` (and later subscription/seat flags) into the JWT from
     `profiles.role`. This is what `public.current_app_role()` already reads.
   - Document the hook SQL and the dashboard/`config.toml` setting. The hook runs
     server-side; the role can never be set by the client.
   - Harness: extend to assert that a client whose `profiles.role` is `coach`
     gets coach visibility *only* via the claim, not via client-supplied values.

5. **Role-gated navigation**
   - Expo Router groups: `(auth)` (signed out), `(client)`, `(coach)`, `(admin)`.
   - A root guard reads the session + role claim and redirects. No role yet
     → onboarding. Deep links respect the guard.

## Data / schema
- New migration for the bootstrap trigger/function. No new business tables yet.
- Optional `onboarding_complete boolean` on `profiles` if onboarding is added.

## Validation & errors
- Zod-validate any profile fields the user may edit (reuse
  `profileSelfInsertSchema`); allowlist fields — never spread `req.body` (§4).
- Generic client errors; detailed logs server-side only.

## Acceptance / tests
- Harness stays green; add cases: bootstrap creates exactly one client profile;
  role claim drives visibility; a user cannot self-assign role/coach via any path.
- Manual: sign up → land in client area; an admin-promoted user (via service role)
  gets coach/admin nav after token refresh.

## Out of scope
Coach↔client assignment UI (Phase 2), plans, uploads, chat, payments.
