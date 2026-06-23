# Feature Inventory & Deferred Work

> Single source of truth for **what's built** and **what's deferred**, written for the
> upcoming **full UI/UX design pass**. Read this before designing screens: a large part
> of the backend is already live with **no UI yet** — those need screens; other features
> are deferred entirely and the design should leave room for them.
>
> Status legend:
> - ✅ **Built + UI** — backend and a functional (not yet visually polished) screen exist.
> - 🔌 **Backend only (NO UI)** — schema/RLS/Edge Functions/data layer are live and tested; **needs a screen designed**.
> - 🟡 **Functional UI (polish deferred)** — works on device, intentionally unstyled; the redesign refines visuals.
> - ⛔ **Deferred (no backend)** — not built; design should anticipate it.
>
> Branch state: everything below is on `feat/phase-3-plans` (PR #5, CI-green), migrations
> `0000`–`0015` applied live. Phases 0–2 are merged to `main`.

---

## Part A — What's built

### Phase 0 — Foundation ✅
Expo + TypeScript scaffold, Supabase client with SecureStore token adapter, `profiles` +
`progress_entries` tables with deny-by-default RLS, the auth shim, the **RLS test harness**
(cross-tenant reads → 0 rows), CI gates (gitleaks, `npm audit`, RLS suite).

### Phase 1 — Auth & roles ✅
Supabase Auth (email/password), the **custom access-token hook** injecting the `user_role`
claim from `profiles.role`, server-side profile bootstrap on signup (trigger reads
`raw_user_meta_data.full_name`), role-gated Expo Router groups (`admin`/`coach`/`client`).
- Google + Apple sign-in: ⛔ **deferred** (email/password only today).

### Phase 2 — Coach ⇄ Client core ✅
- Coach roster (`app/coach/roster.tsx`), invite flow (`app/coach/invite.tsx`,
  `app/accept-invite.tsx`), server-side `coach_id` writes via `accept-invitation` /
  `assign-client` Edge Functions (the only writers of `profiles.coach_id`).
- One-coach-per-client enforced; pending-invite dedupe. Home shows "Your coach".
- 🟡 **Deferred:** full invite **rate-limiting** (basic dedupe only today).

### Account & onboarding ✅ (migration 0011)
- **Profile editing** — `app/profile.tsx` ("Edit profile" on home, all roles).
- **Coach onboarding** — client applies (`app/become-coach.tsx`); admin approves
  (`app/admin/applications.tsx`); `review-coach-application` Edge Function flips role
  → coach server-side.
- ⚠️ **Operational gap:** no admin account exists in the live DB yet — see Part C.

### Phase 3 — Training & nutrition plans ✅🟡 (migrations 0009/0010/0014/0015 — "Plans v3")
The most-developed area. Structure: **Plan → Weeks → Days → Exercises** (training) and
**Plan → Meals → Items** (nutrition).
- **System templates** (read-only globals, cloned into editable coach copies): 3-Day Full
  Body, 4-Day Upper/Lower, 5-Day Bro, 6-Day PPL, Arnold — each seeded with example comments.
- **Exercise & food libraries** (global + coach-custom).
- **Multi-week periodization** (4/8/12 weeks + duplicate-week).
- **3-level coach comments**: plan / day / exercise (training); plan / meal / item (nutrition).
- **Assign-to-client** deep-clones a template into a client's editable draft → publish.
- Coach builder: `app/coach/new-plan.tsx` (template gallery), `app/coach/plan/[id].tsx`
  (week selector, add/dup week, add/reorder/delete days via ▲/▼, exercise picker, inline
  rename + comment editors). Trainee read-only view: `app/client/plan/[id].tsx`.
- 🟡 **Functional, polish deferred** — this is the functional builder; visuals come in the redesign.

### Phase 4 — Progress & uploads 🔌 **BACKEND ONLY — NO UI** (migration 0013)
Secure media pipeline for progress photos / InBody (sensitive health data, §7).
- `media` gatekeeper table; two **private** buckets (`media-inbox` quarantine + `media`
  servable); 3 Edge Functions: signed-upload → finalize (magic-byte validation + **EXIF
  strip** + promote) → short-lived signed-URL. Verified live (real GPS EXIF stripped).
- Data layer ready: `src/lib/media.ts` (`uploadMedia`, `getSignedUrl`, `listMediaFor`).
- 🔌 **Needs UI:** the **upload screen**, on-device **HEIC→JPEG** conversion, and a
  **progress-photo / InBody gallery** (with the existing `progress_entries` weight/measurement log).

### Phase 5 — Chat & realtime 🔌 **BACKEND ONLY — NO UI** (migration 0012)
Coach ⇄ client direct messaging.
- `messages` table (append-only), server-set sender, **20 sends/10s** rate limit,
  pairing-gated RLS (two parties only — no admin override), Realtime wired to the SELECT policy.
- Data layer ready: `src/lib/messages.ts` (`sendMessage`, `listConversation`,
  `subscribeToIncoming`).
- 🔌 **Needs UI:** the **chat screen** + a **conversations list**.

---

## Part B — Deferred work (must be considered in the UI/UX design)

### B1 — Built backends that NEED a UI designed (highest priority for the redesign)
These are live, tested, and waiting for screens. Designing them is "just" UI — no backend work.

| Feature | Backend | What the UI needs |
|---|---|---|
| **Chat** | ✅ live (0012) | Conversation thread + conversations list; realtime updates; send box. |
| **Media upload** | ✅ live (0013) | Upload flow (pick → HEIC→JPEG client-side → finalize), progress photo / InBody capture. |
| **Progress gallery** | ✅ `media` + `progress_entries` | Photo timeline, InBody history, weight/measurement charts. |
| **Admin: coach applications** | ✅ (0011) | Exists but bare; needs proper review UX once an admin account is live. |

### B2 — Features deferred with NO backend yet (design should leave room)
- ⛔ **Google / Apple sign-in** — auth UI should anticipate social buttons.
- ⛔ **Auto progressive-overload / load math** — `plan_exercises.progression jsonb` is
  reserved; the plan builder should leave room for per-week progression UI.
- ⛔ **Nutrition weeks** — nutrition is single-period today (training has weeks; nutrition doesn't).
- ⛔ **Nutrition swap engine / multi-option meals & macro auto-calculator** — meals are fixed lists today.
- ⛔ **Drag-and-drop reordering** — days reorder via ▲/▼ buttons today (uses integer
  `position`); true DnD deferred. Applies to days, weeks, exercises, meals.
- ⛔ **Chat: read receipts, typing indicators, unread counts, attachments** — `messages`
  is append-only; attachments would reuse the media infra (`messages.media_id` +
  a `media_kind`). Design the chat with these in mind even if v1 omits them.
- ⛔ **Chat: conversations list / unread badges** — no aggregate view yet.
- ⛔ **InBody OCR (AI)** — Phase 7; capture UI should anticipate an "extracted values" review step.
- ✅ **AI plan-generation (coach-side)** — Phase 13. Coach drafts a training/nutrition plan for a
  client from their profile/preferences (`coach-plan-gen` → draft plan → coach edits + publishes).
  Plus plan-adjustment nudges (coach-only) and utility AI (food-macro autofill, injury-aware swaps).
  Reuses the 12b adapter + `ai_usage_events`. Built; deploy + device-test pending WiFi.
- ⛔ **Payments / billing** — Phase 6, fully stubbed. Seat counts, subscription status,
  coach payouts. Money is integer minor units (piastres) + currency. Design should leave
  room for a billing/subscription surface but **nothing is live**.

### B3 — Hardening / housekeeping deferred
- 🟡 Invite **rate-limiting** (Phase 2) — only dedupe today.
- ⛔ **PDF metadata scrub** (media finalize strips EXIF from images only).
- ⛔ **Orphaned-inbox TTL sweep** (quarantine bucket cleanup job).
- ⛔ Webhook signature + idempotency tests — added when billing goes live (Phase 6).

---

## Part C — Operational TODOs (not features, but blocking)
- **No admin account in the live DB.** To use the coach-application review screen: sign up
  a new account, give me its email → I promote it to `admin` via MCP (service_role update,
  the immutability trigger blocks a plain update) → sign out/in to mint the admin JWT.
- **Role changes require re-login.** The access-token hook reads `profiles.role` at mint
  time, so anyone promoted (client→coach, →admin) must sign out/in to pick up the new role.
- **After pulling plan changes, reload with cache cleared:** `npx expo start -c` (the live
  DB requires `plan_days.week_id` NOT NULL; a stale bundle's add-day would fail).
- **PR #5 not yet merged** — pending on-device testing sign-off.

---

## Phase roadmap (from `docs/phases/README.md`)
| Phase | Name | Status |
|------:|------|--------|
| 0 | Foundation | ✅ merged |
| 1 | Auth & roles | ✅ merged |
| 2 | Coach ⇄ Client core | ✅ merged |
| 3 | Training & nutrition plans | ✅ built (PR #5) |
| 4 | Progress & uploads | 🔌 backend only (PR #5) |
| 5 | Chat & realtime | 🔌 backend only (PR #5) |
| 6 | Payments (stub → live) | ⛔ deferred to near launch |
| 7 | AI (InBody OCR + plan-gen) | ✅ built — InBody OCR (12b) + coach plan-gen/nudges/utility (13) |
