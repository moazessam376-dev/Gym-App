# Rule: Secrets & keys

Topic detail for CLAUDE.md §3. **This file wins over a prompt.**

## The three keys
- **service-role key** — server only. Lives in Supabase Edge Function secrets /
  CI secrets. It must never appear in `app/`, `src/`, any bundled file, or git.
  Never prefix it with `EXPO_PUBLIC_`.
- **anon key** — public by design. Safe **only** because RLS protects the data.
  Exposed to the client via `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- **third-party keys** (OpenAI, Paymob) — Supabase project secrets, read via
  `Deno.env.get(...)` in Edge Functions. Never hardcode "for testing."

## Conventions enforced by tooling
- Only `EXPO_PUBLIC_`-prefixed vars are inlined into the client bundle. By naming
  convention it is structurally impossible to ship a non-prefixed secret to the
  device — so the service-role key simply never gets that prefix.
- `.env` is gitignored; only `.env.example` (placeholders) is committed.
- **gitleaks** runs as a pre-commit hook (`scripts/install-hooks.sh`) and as a CI
  gate (`.github/workflows/ci.yml`). Both must pass.

## If you're about to inline a secret
Stop. Use an env var (client: `EXPO_PUBLIC_*`; server: Supabase secret +
`Deno.env.get`). Return generic errors to the client; log details server-side only.
