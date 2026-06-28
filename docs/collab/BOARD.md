# Collab board — live state

The single source of truth for **what's in flight** across the two agents. **Claude Code
keeps this current** (it owns the GitHub surface). Read it at the start of every session.
For the protocol, see [`WORKFLOW.md`](WORKFLOW.md).

- **`main` baseline:** `abb1d30` (PR #43 — collab workflow setup) — _update when main moves._
- **Last board update:** 2026-06-27

## How to read this
Each task has an **owner** (who builds it — chosen per task), a **branch**, the **spec**
it implements, a **status**, and its **PR**. `glm/*` branches are GLM-authored and
integrated by Claude Code; `cc/*` are Claude-Code-authored. Status: `todo` →
`in-progress` → `in-review` (PR open / CI running) → `merged` → (`deployed` for DB/Edge).

---

## In flight

| Task | Owner | Branch | Spec | Status | PR |
|------|-------|--------|------|--------|----|
| Pilot hardening (GLM review): security + coach IA + seed + profile/@handle/discover | Claude Code | `cc/security-hardening` | `~/.claude/plans/silly-puzzling-starfish.md` · `GYM_APP_PILOT_REVIEW.md` | in-progress | — |

## Up next (assign an owner before starting)

| Task | Candidate phase | Notes |
|------|-----------------|-------|
| _none yet_ | Phases 9–13 per [`../phases/README.md`](../phases/README.md) | Owner assigns per task; Claude Code drafts the GLM brief if GLM takes it |

---

## Shipped (from `docs/phases/README.md`, for orientation)
Phases 0–3 merged · training logging (0016) live · chat UI built (backend 0012) ·
progress/media backend (0013) live · Phases 9–20 + Arabic/RTL slices 1–2 + Raptor reskin
landed on `main`. The forward roadmap (re-sequenced) lives in
[`../phases/README.md`](../phases/README.md).

---

## Log (newest first)
- **2026-06-28** — **Pilot hardening** from the GLM 5-2 review (`GYM_APP_PILOT_REVIEW.md`),
  all claims re-verified against the code first (plan: `silly-puzzling-starfish.md`). On
  `cc/security-hardening` (off the `fix/workout-note-hide-vs-delete` base, which carries 0060):
  **Track C security** — migrations `0061`–`0068` (H-1 audit FK set-null, M-5 accept-invite
  atomic, M-2 disclaimer gate + M-6 edit-pin + M-7 caps in 0063, M-7 food 0064, L-2 coach-req
  cap, L-9 search caps, C-1 email blocklist, H-2 push shared-secret) + Edge/client/config
  (account-delete ban gate, media-finalize per-kind caps, buckets audio MIME, push-send 2nd
  factor + config.toml, sign-up enumeration). All in runner.ts + harness tests; tsc/parity
  green; **NOT applied to prod** (founder: after CI + PR review). **Track A1 coach IA** —
  Clients demoted from the bar (Home·Performance·Chat·Account), `clients.tsx` reframed as a
  goal-aware KPI roster (attention-first + filter chips), CoachHome trophy, Leaderboards out
  of Account. **Track B seed** — `supabase/seed/seed-pilot.ts` (241 users; run gated on the
  0004 hook + go-ahead). **Track A2 profile hub** — `/profile` = identity + @handle + email +
  links to goals/coaching + public-presence; Account collapsed to one Profile row (fixes U-5 + U-7).
  **Track A3 full @handle** — `0069` (handle column + unique + 14-day cooldown trigger + reserved
  blocklist + generate_handle + check_handle_available RPC + signup gen) + `0070` (surfaces @handle on
  get_public_*/list_public_coaches + adds coach outcome counts). **Track A4 discover** — cards show
  @handle + bio + "N tracked · M improved" + verified badge + specialty i18n. tsc + en/ar parity
  green; pushed to `cc/security-hardening`. **Migrations 0061–0070 APPLIED to prod 2026-06-28 (founder
  go-ahead; advisors clean — only the accepted 0029 DEFINER-RPC set + email_blocklist INFO
  deny-by-default + the 2 pre-existing platform WARNs).** STILL PENDING: redeploy the 3 edge fns
  (account-delete C-1, media-finalize M-3, push-send H-2) — those fixes live in fn code, not the DB.
  Also addressed GLM's reverse-review (M1 specialty i18n keys, M3/M4 i18n, signup-cooldown, S1/S2 seed).
- **2026-06-27** — Reconciled the **pre-pilot UX/IA refactor** track onto the board (it
  predates this workflow). On `raptor-ux-ia-refactor` / **PR #42**, off the pre-PR-#43 main:
  Slice A (workout blockers + coach-less Home CTA), B (media delete via the `media-delete`
  Edge fn — **deployed to prod**; + body-metric confirm/date-picker), C foundation (toast +
  haptics + unsaved-guard infra), **D complete (full bilingual EN/AR retrofit of every
  screen + nav titles)**, plus a templates auto-save fix. tsc + en/ar parity green; **not
  merged**. Branch is **behind main** (lacks §14/collab docs) — rebase onto `abb1d30`
  before merging. Remaining: Slices E–H.
- **2026-06-27** — Captured this program's hard-won learnings into the rule files on
  `cc/pre-pilot-learnings` (off `abb1d30`): new `.claude/rules/i18n.md` + `.claude/rules/ui.md`,
  a media-delete-is-an-Edge-fn note in `rls.md`, and §13 pointers. Own small PR so both tracks
  inherit after rebasing onto main.
- **2026-06-27** — Set up the Claude Code × GLM parallel workflow: `AGENTS.md`,
  `docs/collab/{WORKFLOW,BOARD,GLM_BRIEF_TEMPLATE}.md`, and a pointer in `CLAUDE.md §14`.
