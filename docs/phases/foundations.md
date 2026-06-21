# Foundations — cross-cutting architecture & data security

> The shared spine every feature/phase builds on. Read this **before** designing or
> building any new pillar. It exists because the app is many features sharing **one**
> foundation (auth, tenancy, profiles, the coach⇄client relationship) — and the
> biggest risk in a multi-feature product is **inconsistent security/tenancy/units
> across features**, not any single feature. This doc makes those rules uniform.
>
> It complements (does not replace) `CLAUDE.md` and `.claude/rules/*`. Where this
> doc adds detail, those still win on conflict.

---

## 0. Operating principle: scale-ready data, not premature scale infra

We are a **free pilot**. The correct posture:

- **Do now (cheap, expensive-to-retrofit):** correct tenancy/RLS on every table,
  integer units (no floats), append-only financial rows, cursor pagination,
  sensible indexes, per-user rate limits, input allowlists. These are locked in
  cheaply and painful to add later.
- **Defer until usage proves need (expensive, easy-to-retrofit):** caching layers,
  read replicas, sharding, queue infra, load testing, denormalized read models.
  Building these for "millions of users" before we have hundreds is the classic stall.

Rule of thumb: design the **data model** so it *can* scale; don't build the
*infrastructure* to scale until metrics demand it.

---

## 1. Tenancy & RLS — the one model every table follows

Three roles: `admin`, `coach`, `client`. App role comes from the **verified JWT
claim** (`public.current_app_role()`), never client input. Every `public` table
ships `enable row level security` + deny-by-default policies **in the same
migration** (CLAUDE.md §2, `.claude/rules/rls.md`).

**Canonical row-ownership shapes** (reuse, don't reinvent):

| Data shape | SELECT | INSERT/UPDATE/DELETE | Example |
|---|---|---|---|
| Client-owned | owner `OR is_coach_of(user_id) OR admin` | owner only (`user_id = auth.uid()`) | `progress_entries`, `workout_sessions` |
| Child of an owned row | via a `SECURITY DEFINER` helper that resolves up to the parent | same helper | `exercise_set_logs` → `can_*_session` |
| Coach-authored, client-readable | coach owns; client reads own non-draft | coach writes own | `plans` + children |
| Coach/global library | global (`coach_id IS NULL`) + own custom | own custom only | `exercise_library` |
| Two-party (chat) | `sender = auth.uid() OR recipient = auth.uid()` | server sets sender; pairing-gated | `messages` |
| Server-only writes | owner/coach/admin read | **no client grant** — Edge Function (service role) only | `media`, `coach_id` reassignment |

**Non-negotiable patterns:**
- **Cross-table checks use a `SECURITY DEFINER` helper** (`set search_path = ''`,
  schema-qualify every name) so a policy never re-enters another table's RLS and
  recurses. See `is_coach_of`, `can_read_session`. New child tables add their own
  `can_read_*/can_write_*` helper in the same shape.
- **Ownership/role/billing changes are server-side only** (service role inside an
  Edge Function) and enforced by an **immutability trigger** (see
  `enforce_profile_immutables`). A client INSERT/UPDATE can never set these.
- **Cross-tenant aggregation** (e.g. a coach leaderboard) goes through a
  `SECURITY DEFINER` function **fenced by `where … = auth.uid()`** — never a
  client-side query, which would leak other tenants. See `coach_leaderboard`.
- Policies are `to authenticated`; `to anon` only when truly public (anon always
  resolves to 0 rows via RLS regardless).

**Test gate:** every new table needs, in `supabase/tests/rls/`, a cross-tenant
denial (expect 0), an owner + coach positive control, and a forged-owner-insert
rejection. The "every public table has RLS enabled" invariant covers it
automatically. A failing cross-tenant test is a build failure (CLAUDE.md §11).

---

## 2. Input validation & mass-assignment

- **Every** mutation validates against an explicit **Zod schema** in `src/schemas/`
  and the data layer in `src/lib/` allowlists fields — never spread `req.body` /
  the input object into an insert/update.
- Server-controlled fields (`user_id`, `sender_id`, `coach_id`, `version`,
  timestamps, `status` transitions) are set by the server/DB, never accepted from
  the client even if present in the payload.
- Return **generic** errors to the client; log details server-side only.

---

## 3. Units & money — integers everywhere

- **Money** = integer minor units (piastres) + explicit `currency`. Never floats.
  `transactions` is generic + append-only from day one (see `.claude/rules/money.md`).
- **The same discipline extends to all measured quantities:** `weight_grams`,
  `load_grams`, `rest_seconds`, macros per-100g. **New nutrition logging must store
  integers** — kcal as integer, macros as integer grams (or integer
  centigrams/milligrams if more precision is needed), portion as integer grams.
  Pick the integer unit per column and document it next to the column. No float
  food/macro/calorie columns, ever.
- Body-composition metrics (Pillar E) follow suit: body-fat as integer
  basis-points or per-mille (e.g. `body_fat_bp` where 1850 = 18.50%), muscle mass
  as `grams`. Never a float percentage.

---

## 4. Rate limiting & abuse — one framework, reused

Two enforcement layers, picked by risk:

1. **DB-side per-user rate check** (cheap, for high-frequency client writes):
   a trigger/policy counts the actor's recent rows in a window and raises
   `rate_limited`. Pattern already live for `messages` (20 sends / 10 s). Reuse
   this shape for: food-log spam, set-log floods, invite creation.
2. **Edge Function limits** (for expensive/external ops): per-user counters before
   calling OpenAI / OCR / signed-upload. Targets from CLAUDE.md §9: InBody OCR
   5/hr, plan-gen 10/day/coach, upload N/hr. Centralize the counter helper so each
   function doesn't reinvent it.

**Anti-cheat (Pillar E — InBody verification)** is a first-class security concern,
not a feature nicety:
- The InBody metric that drives ranks must be **server-verified**, never
  client-asserted. The flow: client/coach uploads the InBody **photo/PDF** →
  server extracts values (OCR, Phase-7) → **human-in-the-loop confirm** → the
  *verified* row is what ranks read. Raw client-entered numbers (if allowed at all)
  are flagged unverified and excluded from competitive ranks.
- Store provenance on every metric row: `source` (`coach_entered | inbody_ocr |
  device`), `verified_at`, `verified_by`, and a link to the source `media` row.
  Ranks query only `verified` rows.
- Rate-limit submissions; dedupe by source media id (a `UNIQUE` on the verified
  media reference) so the same scan can't be double-counted.

---

## 5. Files & sensitive health data

InBody scans and progress photos are sensitive health data (CLAUDE.md §7). The
pipeline is already built (migration 0013) and **every new file feature reuses it**:
- **Private** buckets only; serve via **short-lived signed URLs**; never a public
  bucket for user data.
- Validate type by **magic bytes** (jpg/png/heic/pdf, ≤10 MB), **strip EXIF** on
  upload (GPS/PII), quarantine→promote. Client never writes the `media` row —
  Edge Functions (service role) do.
- Chat attachments (Pillar F) reuse this: `messages.media_id` + a `media_kind`,
  served by the same signed-URL path. Deferred: PDF metadata scrub, orphaned-inbox
  TTL sweep.

---

## 6. Realtime, auth propagation, secrets

- **Realtime respects RLS** — subscriptions only deliver rows the channel's policy
  allows. Filter server-side via the policy, not just the client filter.
- **Role changes require re-login.** The access-token hook stamps `user_role` at
  mint time from `profiles.role`; a promoted user (client→coach→admin) must sign
  out/in to pick it up. Surface this in any role-changing UI.
- **Service-role key is server-only** (Edge Function / Supabase secrets), never
  `EXPO_PUBLIC_`, never bundled. Anon key is public by design — safe *only* because
  RLS protects the data. Third-party keys (OpenAI/Paymob) via `Deno.env.get`.

---

## 7. Personalization spine (why Questionnaire/Goals is a *foundation*)

Goals data is not just another feature — it's read by many pillars, so its shape is
designed **early** and centrally:
- **Athlete goals** (target weight, body-comp goal, training days/week, dietary
  constraints, experience) → seed **macro/calorie targets** (Pillar C) and frame
  **progress** (Pillar D) and **rank context** (Pillar E).
- **Coach profile/specialties** → matching, templates, and the coach dashboard.
- Stored as a versioned, owner-scoped `profiles`-adjacent table (e.g.
  `athlete_profile` / `coach_profile`) with the standard client-owned RLS shape,
  readable by the assigned coach. Downstream features read goals; they don't
  re-ask. Treat the questionnaire schema as a contract other pillars depend on.

---

## 8. Definition of done for every new pillar

A pillar/phase is not done until:
1. Tables ship with deny-by-default RLS **in the same migration**; helpers follow §1.
2. Every mutation has a Zod schema + allowlisted data layer (§2); integer units (§3).
3. Rate limits / abuse controls where applicable (§4); files via the secure
   pipeline (§5).
4. RLS harness extended (cross-tenant denial + positive controls) and **green** in CI.
5. `get_advisors` shows no new security findings beyond the accepted
   SECURITY-DEFINER-helper pattern.
6. Validated on a real DB (CI on Postgres 16; prod migrations applied via MCP after
   CI is green).
