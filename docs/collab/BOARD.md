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
| Pre-pilot UX/IA refactor (Slices A–H) | Claude Code | `raptor-ux-ia-refactor` | `~/.claude/plans/staged-floating-lampson.md` · `docs/ux-audit-progress.md` | in-progress | [#42](https://github.com/moazessam376-dev/Gym-App/pull/42) |
| Pre-pilot learnings → rule files | Claude Code | `cc/pre-pilot-learnings` | `.claude/rules/{i18n,ui}.md` + `rls.md` media note | in-review | — |

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
