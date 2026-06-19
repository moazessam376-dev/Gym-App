# Build roadmap

We build **one phase at a time** (CLAUDE.md §11). Each phase is a vertical slice
that ships its tables *with* RLS, validates input with Zod, and keeps the RLS
harness green. Payments and AI are deliberately last — billing is stubbed during
the pilot but the data model stays payment-aware throughout (see
`.claude/rules/money.md`).

Each phase maps to sections of the project constitution (CLAUDE.md).

| Phase | Name | Maps to | Spec |
|------:|------|---------|------|
| 0 | Foundation | §2 §3 §5 §10 §11 | [phase-0-foundation.md](./phase-0-foundation.md) ✅ |
| 1 | Auth & roles | §1 §5 | [phase-1-auth-and-roles.md](./phase-1-auth-and-roles.md) |
| 2 | Coach ⇄ Client core | §2 | [phase-2-coach-client-core.md](./phase-2-coach-client-core.md) |
| 3 | Training & nutrition plans | §2 §4 | outline below |
| 4 | Progress & uploads | §7 | outline below |
| 5 | Chat & realtime | §8 | outline below |
| 6 | Payments (stub → live) | §6 §9 §11 | outline below |
| 7 | AI (InBody OCR + plan-gen) | §9 | outline below |

## Phase 0 — Foundation ✅ (this PR)
Repo scaffold (Expo + TypeScript), Supabase client with a SecureStore adapter,
`profiles` + `progress_entries` tables with deny-by-default RLS, the auth shim +
**RLS test harness** (cross-tenant reads → 0 rows), and CI gates (gitleaks,
`npm audit`, RLS suite). Full detail in the linked spec.

## Phase 1 — Auth & roles
Supabase Auth (email/password first, then Google + Apple), the **custom
access-token hook** that injects the `user_role` claim from `profiles.role`,
profile bootstrap on signup (move from client self-insert to a trigger/Edge
Function), and role-gated Expo Router groups. Detailed spec linked above.

## Phase 2 — Coach ⇄ Client core
Coach roster, client assignment via **server-side** `coach_id` writes (Edge
Function using the service role), and an invitation flow. Detailed spec linked above.

## Phase 3 — Training & nutrition plans *(outline)*
- Tables: `plans`, `plan_items` (and/or `workouts`/`meals`) owned by a coach,
  assigned to a client; versioned; RLS so a coach writes and the assigned client
  reads their own.
- Zod schemas for every mutation; allowlist fields (no `req.body` spread).
- Harness: coach can author for own clients; client reads only assigned plans;
  cross-tenant denied.

## Phase 4 — Progress & uploads *(outline)*
- InBody scans + progress photos (sensitive health data, §7): **private** buckets,
  short-lived **signed URLs** only, validate file type by **magic bytes**
  (jpg/png/heic/pdf, ≤10MB), **strip EXIF** on upload.
- Extend `progress_entries`; add `media` table with owner RLS.

## Phase 5 — Chat & realtime *(outline)*
- `messages` table; RLS limits rows to `sender_id = auth.uid() OR recipient_id =
  auth.uid()` (§8). Server sets `sender_id = auth.uid()` on insert; rate-limit
  sends; sanitize on render (no raw HTML). Realtime respects RLS.

## Phase 6 — Payments (stub → live) *(outline, deferred to near launch)*
- `transactions` (generic, append-only, integer minor units + `currency`),
  `PaymentProvider` adapter, Paymob behind it. Webhooks: **verify HMAC first**,
  timestamp tolerance, idempotency key (`UNIQUE`) before any state change. Seat
  count + active status are server-side truth. Add the webhook signature +
  idempotency CI job (§11). See `.claude/rules/money.md`.

## Phase 7 — AI (InBody OCR + plan-gen) *(outline)*
- OpenAI behind per-user rate limits (InBody OCR 5/hr, plan-gen 10/day/coach, §9).
  Treat all user-supplied content as untrusted (prompt-injection guarding),
  validate model output against a Zod schema before storing, keep a
  human-in-the-loop confirm step.
