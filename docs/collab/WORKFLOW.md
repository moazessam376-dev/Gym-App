# Two-agent workflow — Claude Code × GLM

How **Claude Code** and **GLM 5-2** build this repo in parallel with the **least manual
effort** for the human owner. Read this with [`../../AGENTS.md`](../../AGENTS.md) and the
live [`BOARD.md`](BOARD.md).

> **Decided up front:** GLM hands work back as a **unified diff**; **task ownership is
> chosen per task** (the owner tells us who builds what before each task). Everything
> below is the fixed protocol around those two facts.

---

## 1. Roles

| | Claude Code | GLM 5-2 |
|---|---|---|
| GitHub (branch/commit/push/PR/merge) | **Owns all of it** | none — cannot push |
| Database: migrations, RLS, Edge Functions, deploys | **Owns all of it** | only if its brief says so, via the migration rule (§5) |
| App/UI/feature slices (screens, hooks, i18n, components) | can build | **builds its assigned slice** |
| Reviewing the *other* agent's change against the constitution | **Owns it** (GLM never auto-loaded `CLAUDE.md`) | n/a |
| Keeping [`BOARD.md`](BOARD.md) current | **Owns it** | n/a |

Ownership of a given task (UI slice, whole phase, etc.) is **not fixed** — the owner
assigns it per task. The collision rules in §5 hold **no matter who** takes what.

---

## 2. The loop (what each turn looks like)

The human's manual steps are only the **two handoffs marked 👤**. Everything else is an
agent's job.

1. **Owner picks the next task** and who builds it (Claude Code or GLM).
2. **Claude Code** records it on [`BOARD.md`](BOARD.md) and, if GLM is building it,
   **generates a filled brief** from [`GLM_BRIEF_TEMPLATE.md`](GLM_BRIEF_TEMPLATE.md)
   (scope, allowed/forbidden files, base commit SHA, DoD).
3. 👤 **Owner pastes the brief into GLM** and lets it work.
4. **GLM** builds the slice and outputs **one unified diff** against the base SHA.
5. 👤 **Owner downloads the diff and hands it to Claude Code** (paste the patch text or
   upload the `.patch` file into a Claude Code session).
6. **Claude Code** integrates it (§4): apply → **security-review against the constitution
   (§6)** → fix/flag → commit with GLM provenance → push → open a CI-gated PR.
7. **Claude Code** merges once CI is green (or reports what's blocking) and updates the
   board.

If Claude Code builds the task itself, steps 3–5 collapse — it just builds, pushes, PRs,
and updates the board.

---

## 3. Branches & PRs

- **One branch per task**, created by Claude Code, PR'd to `main`:
  - `glm/<short-task>` — work **authored by GLM**, integrated by Claude Code.
  - `cc/<short-task>` — work authored by Claude Code.
- Every change lands via a **PR so CI gates it** (gitleaks · `npm audit` · RLS suite —
  see [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)). Claude Code merges
  when green; it does **not** open a PR or merge without the owner's go-ahead when the
  owner has asked to review first.
- **PROD deploys (migrations / Edge Functions) need the owner's explicit go-ahead each
  time** (`CLAUDE.md §11`). Merging a PR ≠ authorization to deploy.

---

## 4. Handoff format — the unified diff

**GLM produces** (told via its brief):
- A single **unified diff** against the **base commit SHA** named in the brief
  (`git diff <base-sha>` style, with `a/` `b/` paths from the repo root), covering only
  the files in its allowed scope.
- New files included in full (diff against `/dev/null`). No binary blobs in the diff —
  if an asset is needed, describe it and let Claude Code add it.

**Claude Code integrates**:
1. `git checkout -b glm/<task> <base-sha>` then `git apply --3way <patch>` (or
   `git apply --reject` and resolve `.rej` hunks if the base drifted).
2. If the patch won't apply cleanly because `main` moved, re-base the intent onto current
   `main` by hand — never force a dirty apply.
3. Run the local gates it can (`tsc`, en/ar parity, and the RLS harness via MCP/CI).
4. **Security-review the diff (§6)**, fix anything that violates the constitution (or, if
   it's a design conflict, flag it to the owner rather than silently "fixing").
5. Commit with provenance so the history shows GLM authored it, e.g.
   `glm: <phase/slice> — <summary>` and a trailer `Co-authored-by`-style note in the body
   (`Authored-by: GLM 5-2 (integrated by Claude Code)`).
6. Push `-u origin glm/<task>` and open the PR.

---

## 5. Collision-avoidance rules (apply no matter who owns the task)

Parallel work only stays clean if the two agents never edit the same hot-spot in the same
task window. **One owner per file-area per task.** The high-cost shared files:

- **`supabase/migrations/*` — numbering + apply order.** Only **one** agent authors
  migrations in a given task window, and by default that is **Claude Code**. If GLM must
  add a migration, its brief says so and GLM names it
  `NNNN_PLACEHOLDER_<desc>.sql` — **Claude Code assigns the real zero-padded number at
  integration** (migrations apply in lexical order; a guessed number collides).
- **`supabase/tests/rls/runner.ts` — the hardcoded `migrationFiles` array.** Every new
  migration must be added here too, or it isn't applied/tested. **Claude Code owns this
  edit** (it pairs with assigning the migration number).
- **`src/i18n/locales/en.json` + `ar.json` — full key parity is enforced.** If both
  agents add keys in parallel they collide and break the parity check. Whoever owns a
  task that adds copy adds **both** locales together; the other agent doesn't touch them
  that window. Run the en/ar parity check before commit.
- **`supabase/functions/_shared/*` — redeploy coupling.** Editing a shared contract
  changes nothing until **every** importing function is redeployed (`CLAUDE.md §11`).
  Edge-Function work is Claude Code's by default.
- **`package.json` / `package-lock.json` — dependencies.** Confirm a package exists on
  npmjs.com first (`CLAUDE.md §10`); keep the lockfile committed. Avoid two agents
  changing deps in the same window.
- **`CLAUDE.md`, `docs/phases/README.md`, `BOARD.md`** — coordination files; Claude Code
  edits these.

If a task genuinely needs both agents in the same hot file, **split it into two
sequential tasks** instead of running them in parallel.

---

## 6. Claude Code's review gate (because GLM never loaded the constitution)

Before committing **any** GLM diff, Claude Code checks it against the reject list — this
is the safety net for the agent that didn't auto-load `CLAUDE.md`:

- [ ] No `disable row level security`; any new table ships its RLS policies in the **same**
      migration; cross-tenant reads still return 0 rows (RLS harness green).
- [ ] No secret / API key in the diff; no service-role key in `app/`/`src/`/any bundled
      file; no non-`EXPO_PUBLIC_` secret reaching the client.
- [ ] Every new mutating path validates input with a Zod schema (allowlisted fields — no
      `{...req.body}`); no string-concatenated SQL.
- [ ] Money stays integer minor units + `currency`; measured values stay integers
      (e.g. `weight_grams`), never floats.
- [ ] Tokens via SecureStore; no public buckets for user data; files validated by magic
      bytes + EXIF-stripped where the diff touches uploads.
- [ ] Every new user-facing string goes through `t()` with **both** `en.json` + `ar.json`
      (parity), RTL-safe.
- [ ] `tsc` clean; no dependency that isn't confirmed real.

A violation that's a clear mistake → Claude Code fixes it and notes it on the PR. A
violation that reflects a **design conflict** with the constitution → Claude Code **stops
and asks the owner** (`AskUserQuestion`), per `CLAUDE.md §11`.

---

## 7. Definition of done (every task, from `foundations.md` + `CLAUDE.md §11`)

A task is done when: the PR's CI is green (gitleaks · `npm audit` · RLS suite); `tsc`
passes; en/ar key parity holds; new tables have RLS + a cross-tenant denial test; mutating
endpoints have Zod validation; no secrets; and the board is updated. DB/Edge changes are
**merged but not deployed** until the owner authorizes the prod deploy.

---

## 8. Conflict resolution

- **Patch won't apply** → Claude Code re-bases GLM's intent onto current `main` by hand
  (§4.2), never a dirty/forced apply.
- **Two branches touched the same file** → the second to merge rebases on `main` and
  re-runs CI; Claude Code resolves.
- **Ambiguous requirement or a change that fights the constitution** → don't guess; ask
  the owner.
