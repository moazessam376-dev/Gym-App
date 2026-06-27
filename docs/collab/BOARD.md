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
| Tab-switch black-frame fix | GLM 5-2 | `glm/tab-switch-black-screen` | dev-mode tab flash (`docs/pre-launch-checklist.md`, `CLAUDE.md §13`) | in-review | [#44](https://github.com/moazessam376-dev/Gym-App/pull/44) |

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
- **2026-06-27** — Integrated GLM's **tab-switch black-frame fix** (`freezeOnBlur: false`
  on the tabs layout + dropped the volatile `key` on the two `ZoomIn` hero views). GLM's
  patch arrived paste-mangled (unified-diff prefixes stripped) so it wouldn't `git apply`;
  re-based the intent by hand per WORKFLOW §4.2 — result is byte-identical to GLM's
  (post-image blob hashes match). `tsc` + en/ar parity green. **PR #44** on
  `glm/tab-switch-black-screen` — first run of the two-agent loop; awaiting owner review,
  **not merged**. (PR #43 — the workflow setup — is now the `main` baseline `abb1d30`.)
- **2026-06-27** — Set up the Claude Code × GLM parallel workflow: `AGENTS.md`,
  `docs/collab/{WORKFLOW,BOARD,GLM_BRIEF_TEMPLATE}.md`, and a pointer in `CLAUDE.md §14`.
