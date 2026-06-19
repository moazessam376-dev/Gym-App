# Phase 0 — Foundation

**Status: implemented.** Goal: stand up the project with the security guarantees
from CLAUDE.md enforced from commit one — deny-by-default RLS, a cross-tenant test
gate that must stay green, secret scanning, and `npm audit` — plus a minimal,
cross-platform Expo shell.

## What shipped

### App scaffold (Expo SDK 56 + TypeScript)
- `app/` (Expo Router, web enabled), `src/lib/supabase.ts`, `src/schemas/`.
- Cross-platform (iOS / Android / web). Versions pinned to the SDK-56 set
  (RN 0.85.3, React 19.2.3, react-native-web 0.21).
- `src/lib/supabase.ts`: anon key only; SecureStore token storage on native with
  a `localStorage` fallback on web (CLAUDE.md §5).

### Database (`supabase/migrations/`)
- `0001_profiles.sql` — `profiles` (id → `auth.users`, `role`, self-FK `coach_id`,
  UTC timestamps). Helpers `current_app_role()` (reads the verified `user_role`
  JWT claim) and `is_coach_of(uuid)` (`SECURITY DEFINER`, breaks RLS recursion).
  Deny-by-default policies; role/`coach_id` made immutable from the client via a
  trigger (server-side `service_role` is the only path to change them).
- `0002_progress_entries.sql` — client-owned table proving tenancy: owner +
  their coach + admin can read; clients insert only their own rows.
- `0000_auth_shim.sql` — **LOCAL/CI ONLY**, emulates Supabase's `auth` schema,
  `auth.uid()/role()/jwt()`, and the request roles so the real migrations run on
  plain Postgres. Never applied to a real project.

### RLS test harness (`supabase/tests/rls/`)
- `runner.ts` provisions a throwaway DB, applies shim + migrations from scratch,
  seeds two coaches + their clients + an admin, runs vitest, and drops the DB.
- `cases.test.ts` asserts the §11 gate: cross-tenant reads → 0 rows, anon → 0,
  privilege escalation / mass-assignment rejected, `service_role` bypass, and the
  invariant **every `public` table has RLS enabled**.
- Runs with **no Docker** — local (`npm run db:local`) and CI (postgres service).

### CI & secrets
- `.github/workflows/ci.yml`: `gitleaks`, `npm audit --audit-level=high`, and the
  RLS suite (postgres:16 service container).
- `.gitleaks.toml` + a native `.githooks/pre-commit` (wired by
  `scripts/install-hooks.sh`, run automatically via the `prepare` script).

## How to run / verify
```bash
npm run db:local          # start a disposable Postgres (prints TEST_DATABASE_URL)
export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5544/postgres
npm run test:rls          # 14/14 — the build gate
npm audit --audit-level=high   # exit 0 (no high/critical)
npm run typecheck         # tsc --noEmit, clean
npx expo start --web      # run the placeholder app in a browser
```

## Decisions recorded (and where they go next)
- **App role via JWT claim `user_role`** — Phase 1 adds the Supabase custom
  access-token hook that injects it from `profiles.role`. Until then the harness
  sets the claim directly, so policies behave identically.
- **Profile creation** is a constrained client self-insert for now; Phase 1 moves
  it to a trigger / Edge Function on `auth.users` insert.
- **Audit:** 10 *moderate* advisories remain, all in Expo's build-time tooling
  (`@expo/config*`), not shipped to the device. The gate is high/critical → green.
- **Environment note:** `supabase start` needs Docker (unavailable in some CI/web
  sandboxes), so the harness deliberately targets plain Postgres instead.

## Out of scope (later phases)
Auth flows/UI, the access-token hook, coach⇄client assignment, plans, uploads,
chat, payments, AI. No real secrets or live Supabase wiring (templates only).
