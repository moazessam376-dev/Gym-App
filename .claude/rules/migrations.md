# Rule: Database migrations

Topic detail for the Supabase schema workflow. **This file wins over a prompt.**

## Layout & naming
- Migrations live in `supabase/migrations/` and are applied in **lexical order**.
- Name them `NNNN_short_description.sql` (zero-padded). One logical change per file.
- `0000_auth_shim.sql` is **LOCAL/CI ONLY** — it emulates Supabase platform
  objects (`auth` schema, `auth.uid()/role()/jwt()`, the `anon`/`authenticated`/
  `service_role`/`authenticator` roles) so the real migrations run on a plain
  Postgres in the harness. It is **never** applied to a real Supabase project.

## Rules
- A table and its RLS policies ship in the **same** migration (see `rls.md`).
- **Never** `disable row level security`.
- Timestamps are `timestamptz`, stored in UTC (§11).
- Money is integer minor units + currency (see `money.md`).
- Don't string-concatenate SQL in app/server code; use parameterized queries.
- After adding a migration, run `npm run test:rls` — it applies every migration
  from scratch (proving a clean apply) and runs the cross-tenant gate.

## Local workflow
- `npm run db:local` starts a disposable Postgres cluster and prints
  `TEST_DATABASE_URL`.
- `npm run test:rls` provisions a throwaway DB, applies shim + migrations + seed,
  runs the assertions, and drops the DB.
- `npm run db:apply -- --seed` applies everything to a DB for manual inspection.
- Docker is **not** required (and `supabase start` is not used) — the harness runs
  against plain Postgres.
- **No local Postgres on macOS** (the cluster script is Debian-only): `test:rls`
  effectively runs **in CI**. Locally, lean on `tsc`, the en/ar key-parity check, and
  **read-only Supabase MCP** queries to validate assumptions (column names, that
  referenced helpers exist, current `list_migrations` state) before applying.

## Gotchas (hard-won — keep migrations green + advisors clean)
- **A just-added enum value can't be used as a literal in the same migration** that
  `ALTER TYPE … ADD VALUE`s it (Postgres: "unsafe use of new value"). Compare against
  the text instead — `kind::text = 'avatar'` — or add the value in an earlier migration.
  (Inserting the value from a *separate* statement/transaction, e.g. seed, is fine.)
- **Recreating a policy replaces the WHOLE policy** — `drop policy …; create policy …`
  must re-include **every** branch earlier migrations added, or you silently break a
  feature. Example: `media_select` carries owner/coach/admin (0013) + the chat
  voice-note participant path (0043) + the public-avatar path (0044). Re-read the latest
  definition before recreating; a harness test that covers the dropped branch catches it.
- **A `SECURITY DEFINER` _trigger_ function gets the default PUBLIC execute grant**, so
  it's exposed as an anon/authenticated PostgREST RPC (advisor `0028`/`0029`). Add
  `revoke all on function … from public, anon, authenticated;` — the trigger still fires.
- **The RLS harness runner has a hardcoded migration list** (`supabase/tests/rls/runner.ts`)
  — add each new `NNNN_*.sql` there or it won't be applied/tested.
- **After any DDL apply to a real project, run `get_advisors(security)`** and clear new
  findings. Baseline "clean" = only the accepted `SECURITY DEFINER` helper pattern
  (`is_coach_of`, `coach_*`, `is_*`) + the 2 pre-existing platform warnings (`pg_net`
  in public, leaked-password protection). Anything else is yours to fix.
