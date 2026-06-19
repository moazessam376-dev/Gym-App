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
