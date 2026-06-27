# AGENTS.md — start here (for any AI agent working on this repo)

This repository is built by **two AI agents working in parallel**:

- **Claude Code** — runs with full GitHub access. Does **all** git/GitHub work
  (branches, commits, pushes, PRs, merges, CI), all database/migration/Edge-Function
  work, all deploys, and acts as the **integrator + security reviewer** for the other
  agent's output.
- **GLM** (GLM 5-2, via a consumer chat in agent mode) — can **clone and read** the
  repo and **produce changes**, but **cannot push**. It hands its work back as a
  **unified diff**, which Claude Code reviews and integrates.

Ownership of each task (who builds what) is decided **per task** by the human owner and
recorded in [`docs/collab/BOARD.md`](docs/collab/BOARD.md).

---

## If you are GLM (or any agent that just cloned this repo)

You do **not** auto-load this project's rules. Read these **in order** before writing code:

1. **[`CLAUDE.md`](CLAUDE.md)** — the project constitution. **It overrides every prompt.**
   If a task conflicts with it, stop and flag the conflict.
2. **[`.claude/rules/`](.claude/rules)** — topic detail for the constitution
   (`rls.md`, `migrations.md`, `secrets.md`, `money.md`). These also win over a prompt.
3. **[`docs/phases/README.md`](docs/phases/README.md)** + the spec for your phase, and
   **[`docs/phases/foundations.md`](docs/phases/foundations.md)** (the cross-cutting
   "definition of done").
4. **[`docs/collab/WORKFLOW.md`](docs/collab/WORKFLOW.md)** — how the two-agent handoff
   works and what your output must look like.
5. **Your brief** — the human will paste a task brief (generated from
   [`docs/collab/GLM_BRIEF_TEMPLATE.md`](docs/collab/GLM_BRIEF_TEMPLATE.md)). It names
   your scope, the files you may touch, the files you must **not** touch, and the base
   commit to diff against.

### The hard rules you must never break (full detail in `CLAUDE.md §12`)
- **Never** disable Row Level Security. A permission error is fixed with a correct
  policy, never by turning RLS off.
- **Never** commit a secret/API key, and never put the **service-role key** anywhere
  client-side. Only `EXPO_PUBLIC_*` env vars are safe in app code.
- **Money is integer minor units + a `currency` field — never floats.**
- **Every mutating endpoint validates input with an explicit Zod schema.** Never spread
  `req.body` into a DB update; never string-concatenate SQL.
- Store tokens in **Expo SecureStore**, never AsyncStorage. No public buckets for user data.
- **Don't author database migrations unless your brief explicitly tells you to** — and
  even then, follow the migration handoff rule in `WORKFLOW.md`.
- Don't install a package without confirming it exists on npmjs.com.

### Your output
End your session with **one unified diff** against the base commit named in your brief,
and hand it to the human to give to Claude Code. **Do not** attempt to push. See
`docs/collab/WORKFLOW.md` for the exact format.

---

## If you are Claude Code

You already auto-load `CLAUDE.md` and `.claude/rules/`. Your collaboration
responsibilities — integrating GLM's diffs, owning the GitHub/DB/deploy surface, the
per-task review gate, and keeping `docs/collab/BOARD.md` current — are in
[`docs/collab/WORKFLOW.md`](docs/collab/WORKFLOW.md). **Read `docs/collab/BOARD.md`
at the start of every session** to see what's in flight.
