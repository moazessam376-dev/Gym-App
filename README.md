# Gym-App

A fitness coaching platform (Egypt-based) connecting **coaches** and **clients** —
single codebase, three roles (`admin`, `coach`, `client`), role-gated navigation.

- **Stack:** React Native + Expo (Expo Router, web enabled) · Supabase (Postgres,
  Auth, Storage, Edge Functions, Realtime) · Paymob (payments, later) · OpenAI
  (later). Supabase region: EU (Frankfurt).
- **Status:** Free pilot / early access. Billing is stubbed (see
  `.claude/rules/money.md`). **Phase 0 (Foundation) is implemented.**

The rules in [`CLAUDE.md`](./CLAUDE.md) are the project constitution and override
everything. Topic detail lives in [`.claude/rules/`](./.claude/rules); the build
roadmap is in [`docs/phases/`](./docs/phases/README.md).

## Layout
```
app/                     Expo Router screens (web + native)
src/lib/supabase.ts      Supabase client (anon key, SecureStore tokens)
src/schemas/             Zod contracts
supabase/migrations/     SQL migrations — each table ships with its RLS policies
supabase/tests/rls/      The RLS cross-tenant test harness (must stay green)
scripts/                 db-local / db-apply / install-hooks
.github/workflows/ci.yml gitleaks · npm audit · RLS suite
```

## Security model (non-negotiable)
- **Deny-by-default RLS** on every table; policies ship in the same migration.
- **Service-role key is server-only**; the app uses the public anon key, which is
  safe only because RLS protects the data.
- Tokens live in **SecureStore** (Keychain/Keystore), never AsyncStorage.
- Money is **integer minor units + currency**, never floats.
- Secrets are blocked by **gitleaks** (pre-commit + CI).

## Develop
```bash
npm install                # also wires the git pre-commit hook
cp .env.example .env       # fill EXPO_PUBLIC_* (never put the service-role key here)
npx expo start             # run the app (press w for web)
```

## Test the RLS gate
The harness applies the migrations to a plain Postgres and asserts cross-tenant
isolation. **No Docker required.**
```bash
npm run db:local           # start a disposable Postgres, prints TEST_DATABASE_URL
export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5544/postgres
npm run test:rls           # cross-tenant reads -> 0 rows; escalation rejected
```
CI runs the same suite against a `postgres:16` service container, plus `gitleaks`
and `npm audit --audit-level=high`.
