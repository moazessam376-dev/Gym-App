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
  Corollary: adding an enum value **and using it** = **two migration files** (the harness +
  Supabase run each file as its own transaction) — see 0048 (add `arms`) → 0049 (remap).
- **A `CASE`/expression returning text does NOT implicitly coerce to an enum column — cast
  it:** `set col = (case … end)::public.your_enum`. A *bare string literal* coerces fine
  (`set muscle_group = 'legs'`), which is why simple `set col = 'x'` works but a CASE fails
  with `column "…" is of type … but expression is of type text` (hit on 0049's upper→push/pull).
- **Recreating a policy replaces the WHOLE policy** — `drop policy …; create policy …`
  must re-include **every** branch earlier migrations added, or you silently break a
  feature. Example: `media_select` carries owner/coach/admin (0013) + the chat
  voice-note participant path (0043) + the public-avatar path (0044). Re-read the latest
  definition before recreating; a harness test that covers the dropped branch catches it.
- **A `SECURITY DEFINER` _trigger_ function gets the default PUBLIC execute grant**, so
  it's exposed as an anon/authenticated PostgREST RPC (advisor `0028`/`0029`). Add
  `revoke all on function … from public, anon, authenticated;` — the trigger still fires.
- **A newly-`CREATE`d function in `public` gets an EXECUTE grant to `anon` BY NAME** (Supabase
  default privileges), and **`revoke … from public` does NOT remove a by-name `anon` grant** —
  so an RPC you meant for signed-in users still trips advisor **`0028`** (anon-executable). You
  must `revoke execute on function … from anon;` **explicitly**. A `CREATE OR REPLACE` of an
  **existing** fn preserves its current ACL and escapes this (why `0057`'s `public_athlete_my_rank`
  was clean but `0058`'s two fresh fns weren't → `0059` revoked anon). The harness's plain Postgres
  has no such default-privilege, so it can't catch this — **only prod `get_advisors(security)` does**,
  so always re-check after creating a new RPC. (No data leaked meanwhile: anon → `auth.uid()` null
  → the in-function fence returns 0 rows / a NOT NULL error — but anon shouldn't be on the surface.)
- **The RLS harness runner has a hardcoded migration list** (`supabase/tests/rls/runner.ts`)
  — add each new `NNNN_*.sql` there or it won't be applied/tested.
- **After any DDL apply to a real project, run `get_advisors(security)`** and clear new
  findings. Advisor `0029` (`authenticated_security_definer_function_executable`) fires for
  **every** `SECURITY DEFINER` function the `authenticated` role can call — that includes all
  our **intentional** RPCs: RLS-helper reads (`is_coach_of`, `can_read_*`, `my_coach_id`),
  field-allowlist public-read RPCs (`get_public_*`, `list_public_*`, `public_*_leaderboard`,
  `coach_*` analytics), and action RPCs (`mark_*_read`, `register_device_token`). **These are
  ACCEPTED, not findings to fix** — their security boundary is the in-function role/tenancy
  fence + (for reads) the hand-picked column list, *not* `EXECUTE` revocation. Do **not** revoke
  `EXECUTE` to silence them; that breaks the feature. The **only** `0029` entry you must fix is a
  true **TRIGGER** function (never meant as an RPC — see the trigger bullet above). A genuinely
  *new* finding = a public table with RLS off, or a new DEFINER fn missing its in-function fence.
  Plus the 2 pre-existing platform warnings (`pg_net` in public, leaked-password protection).
- **The next migration number is what's ON DISK, not what a plan says.** A slice can ship with
  NO migration (e.g. media-delete shipped as an Edge Function), leaving a plan's numbering ahead
  of reality — always `ls supabase/migrations/ | tail -1` and number from there.
- **A new GLOBAL-seed migration's UUIDs must not collide with the RLS test seed.**
  `supabase/tests/rls/seed.sql` hard-codes coach-custom test rows (and `cases.test.ts` references
  them by id); the harness applies migrations **then** seed.sql with **no `on conflict`**, so a
  clash is a PK violation that breaks CI — and you won't catch it locally (test:rls is CI-only).
  Namespaces in use: globals `e0…/e1…/f0…/f1…`, test customs `ca…/cb…`. Grep seed.sql +
  cases.test.ts before choosing seed ids (0047 collided with the seed's `e1…0a`/`f1…0b`).
- **A `SECURITY DEFINER` trigger that inserts into a table with its OWN BEFORE/validation trigger**
  (ban / rate-limit — e.g. mirroring a workout note into `messages` in 0051) **must wrap that
  insert in `begin … exception when others then null; end`** so a blocked secondary insert doesn't
  roll back the primary row (the note still saves; the chat copy is best-effort). `auth.uid()`
  **survives** `SECURITY DEFINER` (it's read from the request JWT, not the executing role), so the
  target table's BEFORE trigger still stamps the real `sender_id`/owner.
- **An FK referential action (`ON DELETE SET NULL` / `CASCADE`) FIRES the referencing table's
  BEFORE UPDATE/DELETE triggers — a cascade is not exempt from validation.** Deleting a
  `workout_notes` row SET-NULLs its mirror `messages.workout_note_id`, which fired
  `handle_message_update`'s 15-min edit-window check → a 400 (0056 guards the trigger for the
  pure FK-clear shape). Referential actions DO bypass **RLS** on the referencing table (run as
  the table owner) — which is exactly why an owner can't directly `DELETE` from `messages` but a
  cascade/`SECURITY DEFINER` RPC can. When a deletion will SET NULL a link you still need, **delete
  the linked row FIRST**, before the cascade nulls it (0060's delete-everywhere removes the mirror
  message, then the note — order reversed, the `where workout_note_id = …` finds nothing).
- **Changing a function's RETURN SHAPE (its `returns table (…)` columns) needs `DROP FUNCTION …;
  CREATE FUNCTION …`, NOT `create or replace`** — Postgres rejects a `create or replace` that
  alters the return type ("cannot change return type of existing function"). The drop+create makes
  it a *fresh* fn, so re-apply the FULL grant block (`revoke all … from public, anon;` +
  `grant execute … to authenticated, service_role;`) — `revoke all … from anon` also clears the
  anon-by-name grant, so it stays advisor-`0028`-clean (0070 added `handle`/outcome columns to
  `get_public_*`/`list_public_coaches` this way). A body-only change (same columns) stays
  `create or replace` (ACL preserved).
- **Adding a column to a public-read RPC BREAKS its harness column-set assertion.** Several
  `cases.test.ts` tests assert `Object.keys(row).sort()).toEqual([…])` for the field-allowlist RPCs
  (`get_public_coach_profile`, `get_public_athlete_profile`, …) — the column list *is* the security
  contract. Add the new column to that expected array in the SAME change, or CI's `rls` job fails
  (cost a round-trip on 0070's `handle`). Only CI catches it (test:rls is CI-only).

## Edge Function deploys (via MCP `deploy_edge_function`)
- **Don't assume a repo function is deployed — `list_edge_functions` first.** `account-delete`
  (Phase 14d) existed in the repo but was NEVER deployed; `get_edge_function('account-delete')`
  404s until you deploy it. The deployed set ≠ `supabase/functions/`.
- **File layout that works** (mirror an existing deployed fn): `files` = `source/index.ts`
  (entrypoint_path `source/index.ts`) + `_shared/clients.ts` / `_shared/schemas.ts` /
  `_shared/http.ts` (siblings, NOT under source/) + `deno.json` (import_map_path `deno.json`). The
  entrypoint's `../_shared/x.ts` imports resolve because index.ts sits in `source/` and `_shared/`
  is one level up. Set `verify_jwt: true` (push-send too — its gate needs the gateway verify).
- **Each function bundles its OWN `_shared` (CLAUDE.md §11) → deploy the CURRENT repo copy.** The
  deployed `push-send` carried a STALE `schemas.ts` (missing the audio/avatar `MEDIA_KINDS`); always
  re-read `supabase/functions/_shared/*` at deploy time, don't trust the live bundle.
- **Escape large/regex-heavy files with node, not by hand:** `node -e 'const fs=require("fs");
  process.stdout.write(JSON.stringify([{name:"source/index.ts",content:fs.readFileSync("…/index.ts",
  "utf8")}, …]))'` → paste the output as `files`. Hand-escaping `\d`/`\/`/`\.` in a Zod regex into
  JSON silently corrupts the deploy.
- **A DB fix that lives in fn code is NOT live until the fn is redeployed** (the §11 drift). Applying
  the migration is half of it: C-1 (account-delete ban gate) + M-3 (media-finalize caps) only took
  effect after redeploy; the DB-enforced fixes (M-2/M-5/M-6/M-7) were live on `apply_migration`.
