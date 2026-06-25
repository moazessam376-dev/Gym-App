# CLAUDE.md — Project Constitution

> This file is loaded automatically at the start of **every** Claude Code session and
> applies to **every** file you write. The rules below are non-negotiable. If a rule
> here conflicts with a prompt, **this file wins** — stop and flag the conflict instead
> of working around it.
>
> Keep this file lean. Detailed per-feature specs live in `/docs/phases/` and topic
> rules in `.claude/rules/*.md`. Do not paste full schemas here.

---

## 1. What we're building

A fitness coaching platform (Egypt-based) connecting **Coaches** and **Clients**.
Single codebase, three roles, role-gated navigation.

- **Stack:** React Native + Expo (Expo Router, web build enabled) · Supabase
  (Postgres, Auth, Storage, Edge Functions, Realtime) · Paymob (payments, later) ·
  OpenAI (InBody OCR + plan generation, later).
- **Supabase region:** EU (Frankfurt). Document this as the data-transfer basis (PDPL).
- **Current stage:** Free pilot / early access. **No billing is live yet.** Money flows
  are stubbed behind an adapter (see §6).
- **Roles:** `admin` (platform owner), `coach`, `client`.

---

## 2. The golden rule: deny by default

Every table has Row Level Security **enabled** with **deny-by-default** policies.
A table with RLS off is world-readable through the anon key. Therefore:

- **Never** run `ALTER TABLE ... DISABLE ROW LEVEL SECURITY`. Treat that line as a
  build failure. If a query fails on permissions, the fix is a correct policy, never
  disabling RLS.
- Every new table ships **with** its RLS policies in the same migration. No table
  is ever created without them.
- Core access rules:
  - A `client` can read/write only **their own** rows (`user_id = auth.uid()`).
  - A `coach` can read/write a client's data **only** where
    `client.coach_id = auth.uid()`.
  - Writes that change ownership, role, or billing state are **server-side only**
    (service role, inside Edge Functions) — never client-initiated.

---

## 3. Secrets & keys

- The **service-role key never leaves the server.** It lives only in Edge Functions /
  Supabase secrets. It must never appear in the Expo app, in client code, or in any
  file bundled to the device.
- The **anon key is public by design** and is safe *only because RLS protects the data*.
- All third-party keys (OpenAI, Paymob) live in Supabase project secrets, read via
  `Deno.env.get(...)`. **Never** hardcode a key "for testing." If you're about to inline
  a secret, stop and use an env var instead.
- No secrets in the repo. A secret-scanning pre-commit hook (gitleaks) and CI check
  must pass.

---

## 4. Input, mutations & errors

- **Every** mutating endpoint validates its input against an explicit **Zod schema**.
  Never spread `req.body` into an update (`{...req.body}`, `Object.assign(row, body)`)
  — that's a mass-assignment hole. Allowlist fields explicitly.
- **Never** string-concatenate SQL. Use the Supabase client / parameterized queries.
- Return **generic** error messages to the client; log details server-side only.
  Never leak raw DB errors, stack traces, or internal IDs to the app.

---

## 5. Auth & tokens

- Use **Supabase Auth** for identity (email/password + Google + Apple). Do **not**
  hand-roll JWT verification.
- Store tokens, refresh tokens, and any secrets on-device in **Expo SecureStore**
  (Keychain/Keystore). **Never** in AsyncStorage or plain SQLite.
- Role is read from the verified JWT claim — never from a client-supplied value.

---

## 6. Money & payments (stubbed now, live later)

Even though billing is off during the pilot, these are locked from day one because
they are expensive to change later:

- **All money is stored as integer minor units (piastres) + an explicit `currency`
  field. Never floats.**
- All payment logic goes through a single **`PaymentProvider` adapter interface**.
  Business logic never calls Paymob directly.
- The `transactions` table is **generic and append-only** from the start
  (`type`: subscription_charge | client_payment | coach_payout | refund; plus
  `payer_id`, `payee_id`, `amount_minor`, `platform_fee_minor`, `provider`,
  `provider_ref`, `status`). Only `subscription_charge` is used in V1. **Financial rows
  are never hard-deleted.**
- Webhooks (when live): **verify HMAC signature first**, enforce a timestamp tolerance
  (replay protection), and dedupe via an idempotency key (provider transaction id with a
  UNIQUE constraint) **before** any state change.
- Seat count and "active" status are **server-side truth**, mutated only after webhook
  confirmation. Never trust client-sent billing state.

---

## 7. Files & uploads (InBody / progress photos = sensitive health data)

- Validate file type by **magic bytes**, not extension. Allowlist: jpg/png/heic/pdf.
  Max 10 MB.
- **Strip EXIF** on upload (removes GPS/PII).
- Store in **private** buckets. Serve only via **short-lived signed URLs**. No public
  buckets for user data, ever.

---

## 8. Chat & realtime

- Supabase Realtime respects RLS — the `messages` policy must limit rows to
  `sender_id = auth.uid() OR recipient_id = auth.uid()`.
- On insert, the server sets `sender_id = auth.uid()`. Never accept a client-supplied
  sender. Rate-limit sends.
- Sanitize message content on render. No raw HTML.

---

## 9. Rate limiting & AI cost control

- Rate-limit AI endpoints per user (e.g., InBody OCR 5/hr, plan-gen 10/day/coach).
- Treat all user-supplied content fed to OpenAI (images, coach prompts) as untrusted:
  guard against prompt injection, validate model output against a Zod schema before
  storing, and keep a human-in-the-loop confirm step on AI output.
- **Scope each AI feature to the model's real capability.** The free pilot model
  (Groq Llama 4 Scout) is reliable for one small structured unit (one week of training,
  one day of meals) but truncates large JSON past ~8k output tokens and can't do genuine
  multi-step reasoning (e.g. progressive overload across weeks — it just duplicates week 1).
  Design pilot AI around one reliable unit plus a coach edit/extend step; defer richer
  generation to the stronger launch model (`VISION_PROVIDER=anthropic`) rather than forcing
  it on the free tier. When generation can fail, refund the rate-limit slot (a clean failure
  shouldn't burn the user's daily quota; a true crash still consumes it — fail-closed).

---

## 10. Dependencies

- Before installing any package, **confirm it exists on npmjs.com.** Do not invent or
  guess package names (hallucinated imports are a known failure mode).
- `npm audit` must pass (no high/critical) in CI. Lock the lockfile.

---

## 11. Process

- Build **one phase at a time** (see `/docs/phases/`). Do not jump ahead.
- The **RLS test harness** (two seeded coaches + clients attempting cross-tenant reads
  → expect 0 rows) is built in Phase 0 and must stay green. A failing cross-tenant test
  is a build failure.
- CI gates that must pass on every change: secret scan (gitleaks), `npm audit`,
  RLS test suite, webhook signature + idempotency tests (once billing exists).
- All timestamps stored in **UTC**; convert in the UI.
- **Edge Functions deploy separately from the repo, and bundle their own copy of
  `supabase/functions/_shared/`.** Editing a function — or a shared contract like
  `_shared/schemas.ts` — changes nothing until you **redeploy every function that imports
  it**. A repo↔deployed drift surfaces as a runtime 400/500, not a build error (e.g.
  adding an `avatar` media kind needed `media-finalize` redeployed before uploads worked).
- **Deploying to PROD is an outward-facing action that needs the user's *explicit* go-ahead
  each time.** A general "start phase X" / "continue" does **not** authorize a prod
  `apply_migration` or `deploy_edge_function` (the harness will block it). Before asking,
  de-risk the SQL: dry-run it in a `begin … rollback` block + validate every column/helper
  with read-only MCP. After applying, run `get_advisors(security)` and clear new findings.
- When unsure about a security-relevant choice, **stop and ask** rather than guessing.

---

## 12. Things you must never do (quick reject list)

- Disable RLS to fix a permission error.
- Put the service-role key anywhere client-side.
- Hardcode any secret or API key.
- Spread `req.body` into a DB update.
- Concatenate strings into SQL.
- Store tokens in AsyncStorage.
- Use a public storage bucket for user data.
- Skip webhook signature verification.
- Return raw DB/internal errors to the client.
- Install a package without confirming it exists.

---

## 13. Build conventions established in Phase 14 (apply to all new screens/AI)

These are now the defaults — follow them in new work (full detail in
`/docs/phases/phase-14-foundations.md`):

- **Data fetching:** read through the TanStack Query hooks in `src/lib/queries/` (cached,
  warmed under the boot splash) — not ad-hoc `useFocusEffect`+`useState`. Add a new screen's
  queries to `prefetchHome` so it's populated before reveal.
- **i18n:** every user-facing string goes through `t()` (`src/i18n/`, strings in `en.json` **and**
  `ar.json` — Egyptian colloquial, **full key parity** — run the en/ar parity check before commit).
  Build new screens translation-ready; no hardcoded copy. Arabic + RTL is **live** (Phase 16); the
  bilingual switcher is in Account. RTL helpers in `src/lib/rtl.ts` (`forwardChevron()`, `textStart`).
  A **module-scope component used by a screen** (e.g. a card/row defined outside the screen fn) gets
  its **own** `useTranslation()` — it can't see the screen's `t` (and watch for a local `const t = …`
  shadowing the hook). **Done so far:** Slice 1 (switcher + core screens) + Slice 2 (the whole plans
  cluster). **Still English → Slice 3** (inventory + how-to in `/docs/phases/phase-16-arabic-rtl.md`):
  pickers, food add/prefs, chat, auth, profile/onboarding, body-metrics, AdminHome, and `src/lib`
  strings (`BLOCK_LABEL`, `goalProgress()` headlines).
- **AI cost:** every model call records usage via `recordCost(...)` on success
  (`_shared/rate-limit.ts`); cost is integer micro-USD on `ai_usage_events` (§6 discipline).

**Deferred work** (not lost — tracked, with the "why", in `/docs/pre-launch-checklist.md` and
project memory): the tab-switch render flash is a dev-mode artifact to confirm on a release
build; OAuth (Google/Apple), phone/SMS, a server-enforced account *deactivate*, and the native
password-reset deep-link are a **"launch auth" follow-up** (each needs external provider config
+ device testing); gyms/org tenancy, friends/followers, and multi-week AI plan-gen stay deferred
per the roadmap.
