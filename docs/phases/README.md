# Build roadmap

We build **one phase at a time** (CLAUDE.md §11). Each phase is a vertical slice
that ships its tables *with* RLS, validates input with Zod, keeps the RLS harness
green, and is tested on-device before the next. The shared architecture &
data-security rules every phase obeys live in **[foundations.md](./foundations.md)**
— read it before building any pillar.

> **Planning principle:** foundations + sequencing are planned deeply up front;
> each feature's detailed spec + UI is written **just-in-time at the start of its
> phase** (avoids speccing things we don't understand yet). Per-phase spec docs are
> created when a phase begins.

---

## The product spine: the MVP core loop

Everything sequences around the minimum loop that delivers the core value:

> **Coach assigns a plan → athlete logs training + food → both see progress → they chat.**

A pillar earns "MVP" only if the loop is incomplete without it. Ranks/leaderboards,
InBody verification, AI, and payments sequence **outward** from this loop, not into it.

---

## Status — shipped so far

| Phase | Name | Status |
|------:|------|--------|
| 0 | Foundation (Expo, Supabase, RLS harness, CI) | ✅ merged |
| 1 | Auth & roles (JWT role claim, bootstrap) | ✅ merged |
| 2 | Coach ⇄ Client core (roster, invites, assignment) | ✅ merged |
| 3 | Training & nutrition **plan authoring** (Plans v3) | ✅ built |
| — | **UI redesign** (Neon Glassy Dark, tabs, primitives) | 🔄 PR #6 (CI green, not merged) |
| — | **Training logging** (`workout_sessions`, streak, adherence, leaderboard) | ✅ live (migration 0016) |
| — | **Chat UI** (thread + conversation list + realtime) | ✅ built (backend 0012 live) |
| 4 | Progress & uploads — secure media pipeline | 🔌 backend live (0013), **no UI** |

Original phases 4–7 (progress UI, chat, payments, AI) are folded into the forward
roadmap below at their correct, re-sequenced positions.

---

## Forward roadmap (re-sequenced, priority-ordered)

Priority order set with the founder: **profiles/goals → food logging → body-metrics/
ranking → chat hardening**, all on a clean baseline. `[MVP]` = part of the launch
core loop; `[post-MVP]` = sequences outward.

| Phase | Name | MVP? | Depends on | Spec |
|------:|------|:----:|------------|------|
| 8 | Stabilize & foundations baseline | ✅ | — | this doc + foundations.md |
| 9 | Profiles + Questionnaire + Goals | ✅ | 8 | _at phase start_ |
| 10 | Athlete food & macro logging | ✅ | 9 (targets) | _at phase start_ |
| 11 | Progress & uploads UI (photos/InBody capture + charts) | ✅ | 8 (media live) | _at phase start_ |
| 12 | Body-metrics + InBody ranking (anti-cheat) | post-MVP | 11 | _at phase start_ |
| 13 | Chat hardening & scale | post-MVP | 8 | _at phase start_ |
| L1 | Social sign-in (Google/Apple) | post-MVP | — | outline |
| L2 | Payments (stub → live, Paymob) | post-MVP | — | original §6 |
| L3 | AI — InBody OCR + plan-gen | ✅ built | 11, 12 | InBody OCR (12b) + coach plan-gen/nudges/utility (`phase-13-coach-ai.md`) |

**Launch MVP = Phases 8–11 + the already-built chat.** That ships the full core loop.

---

### Phase 8 — Stabilize & foundations baseline ✅(mostly done)
Get to a clean, consistent base before building new pillars.
- Merge PR #6 (redesign + training logging + chat UI) to `main`.
- Restyle the **plan-builder cluster** (8 coach authoring screens still on old light
  UI) to the design system.
- Land cross-cutting **foundations scaffolding** from foundations.md: a reusable
  per-user **rate-limit helper**, a `profiles.avatar_url` column (+ wire avatars to
  the media pipeline), and remove the dashboard **SAMPLE/dummy data** seams once
  real sources exist.
- **Security focus:** none new — consolidation only.

### Phase 9 — Profiles + Questionnaire + Goals  `[MVP]`
The personalization **foundation** (foundations.md §7) — read by Phases 10–12.
- **Data:** `athlete_profile` (goals: target weight_grams, body-comp goal, training
  days/week, experience, dietary constraints, injuries) + `coach_profile`
  (specialties, bio). Versioned, owner-scoped.
- **Security:** standard client-owned RLS (owner + assigned coach read); allowlisted
  Zod; integer units for any measured goal.
- **UI:** onboarding questionnaire (role-branched) + richer profile/avatar screens.
- **Why first:** macro targets (10), progress framing (11), and rank context (12)
  all read goals; building them first avoids re-asking and rework.

### Phase 10 — Athlete food & macro logging  `[MVP]`
Completes the daily athlete loop (training logging is already live).
- **Data:** `food_log_entries` (date, meal slot, `food_id`→library or custom,
  `grams`, integer macro snapshot) → daily roll-up vs **targets from Phase 9**.
  Reuses `food_library`. All integers (foundations.md §3).
- **Security:** client-owned RLS (owner + coach read); rate-limit log spam (§4).
- **UI:** food diary, quick-add, daily macro/calorie ring vs target.

### Phase 11 — Progress & uploads UI  `[MVP]`
Surfaces the secure media backend (0013) + weight history.
- **Data:** reuse `media` (progress_photo/inbody) + `progress_entries`
  (weight_grams). Add measurement columns if needed (integer).
- **Security:** files via the existing private-bucket + signed-URL + EXIF-strip
  pipeline (foundations.md §5) — no client writes to `media`.
- **UI:** upload flow (pick → HEIC→JPEG → finalize), photo timeline, weight chart,
  InBody capture (anticipates the OCR review step of L3).

### Phase 12 — Body-metrics + InBody ranking (anti-cheat)  `[post-MVP]`
Replaces today's dashboard SAMPLE ranks with **verified** data.
- **Data:** `body_metrics` (weight_grams, body_fat_bp, muscle_mass_grams, `source`,
  `verified_at/by`, `media_id`). Ranks read **verified rows only**.
- **Security (foundations.md §4):** server-verified metrics, never client-asserted;
  provenance + dedupe by source media (`UNIQUE`); rate-limited; the leaderboard is a
  `SECURITY DEFINER` cohort-fenced function (same shape as `coach_leaderboard`).
  Start with **coach-entered** verified metrics; layer InBody-OCR auto-extract in L3.
- **UI:** body-comp trends + the real leaderboard/podium.

### Phase 13 — Chat hardening & scale  `[post-MVP]`
- Read receipts, unread counts, conversations aggregation (last message/unread),
  typing (optional), attachments via `messages.media_id` + the media pipeline.
- **Security:** review/raise the existing 20/10s rate limit, abuse/report flow,
  block list; confirm realtime stays RLS-scoped at volume.

### Later — L1 Social sign-in · L2 Payments · L3 AI (OCR + plan-gen)
Per the original constitution §6/§9 and `.claude/rules/money.md`. Payments stay
stubbed but payment-aware until near launch; AI behind per-user rate limits with a
human-in-the-loop confirm step.

---

## Cross-cutting (apply in every phase, not a phase of their own)
Tenancy/RLS, units, validation, rate-limits, files, secrets, and the
"definition of done" — all in **[foundations.md](./foundations.md)**. Every phase's
DoD checklist comes from there.
