# Collab board — live state

The single source of truth for **what's in flight** across the two agents. **Claude Code
keeps this current** (it owns the GitHub surface). Read it at the start of every session.
For the protocol, see [`WORKFLOW.md`](WORKFLOW.md).

- **`main` baseline:** `6b914d9` (PR #41 — Raptor reskin) — _update when main moves._
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
| Two-agent collab workflow docs | Claude Code | `claude/claude-glm-workflow-setup-2b9ou0` | this doc set | in-review | — |

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
- **2026-06-27** — Set up the Claude Code × GLM parallel workflow: `AGENTS.md`,
  `docs/collab/{WORKFLOW,BOARD,GLM_BRIEF_TEMPLATE}.md`, and a pointer in `CLAUDE.md §14`.
