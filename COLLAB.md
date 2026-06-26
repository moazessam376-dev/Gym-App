# COLLAB.md — Two-model workflow (GLM in z.ai  +  Claude Code)

Runbook for splitting work across **two AI agents**:

- **GLM** (in the z.ai consumer *agent* sandbox) — implements slices and reviews.
- **Claude Code** (your Mac terminal, or a Claude Code web session) — applies GLM's
  work, runs the gates, security-reviews, pushes, and opens the PR.

Both run **in parallel on non-overlapping slices**.

---

## Why this shape (don't skip — it's load-bearing)

We verified the z.ai consumer agent sandbox directly. It has **no durable secret store**,
**no GitHub OAuth connector**, and env vars set in one shell **don't persist and aren't
isolated from the conversation transcript**. Outbound HTTPS works and `git` is installed,
but a push needs a credential, and the only way to get one into that sandbox is to **type it
into the chat** — i.e. leak a live write credential into z.ai's logs.

**Conclusion:** GLM cannot push cleanly. So GLM emits a **patch artifact**, you download it,
and Claude Code does all GitHub work from where your auth already lives. Zero credentials
cross any chat. The patch loop is **just as parallel** as a direct push — the only cost is
one file download + one `git am` per slice.

---

## Roles

| Actor | Does | Never does |
|---|---|---|
| **GLM** | implements a slice; runs the self-checks it can; emits `git format-patch` files | push, open PRs, hold a token |
| **You (human)** | downloads the patch files from the z.ai workspace; relays PR feedback | paste tokens or patches into any chat |
| **Claude Code** | applies the patch; runs **all** gates; security-reviews the diff; pushes; opens the PR | trust the patch blind |

---

## Conventions

- **Base branch per round:** agree ONE base before a round starts (e.g. `raptor-ux-ia-refactor`).
  Every patch in that round applies onto that exact base — mismatched bases = conflicts.
- **One slice per branch**, kept small. Branch name: `slice-<n>-<short-desc>`.
- **Non-overlapping slices** between GLM and Claude Code so branches never collide.

---

## Step 1 — GLM produces the artifact (in z.ai)

```bash
git checkout -b slice-3-food-prefs raptor-ux-ia-refactor   # branch off the agreed base
# ...implement, commit in logical chunks...
git format-patch raptor-ux-ia-refactor..slice-3-food-prefs -o download/slice-3/
```

Then GLM reports to you: **branch name, base, commit count, one-line summary** (optionally a
`download/slice-3/SUMMARY.md`).

> Use `format-patch` (text, human-reviewable, preserves each commit's message + author), **not**
> a binary `git bundle` — bundles don't survive chat and add nothing here. Write into
> `download/` so the files are downloadable from the workspace.

---

## Step 2 — You download (no paste)

Download `download/slice-3/*.patch` from the z.ai workspace to your Mac. **Do not paste patch
contents into any chat** — download the files.

---

## Step 3 — Claude Code: apply → gate → review → push → PR

On the Mac, in the repo, hand Claude Code the patch dir:

```bash
git fetch origin
git checkout -b slice-3-food-prefs origin/raptor-ux-ia-refactor   # SAME base as GLM used
git am path/to/slice-3/*.patch                                    # replays GLM's commits intact
```

### Gates — all must pass before push

```bash
npm ci
npm run typecheck            # tsc --noEmit — NOT run in CI, so it MUST run here
npm run test:rls             # RLS cross-tenant suite (mandatory for any migration slice)
npm audit --audit-level=high
npm run lint:secrets         # gitleaks (also a pre-commit hook + a CI gate)
```
Plus the **en/ar key-parity** check (CLAUDE.md §13): every new `t()` key exists in **both**
`src/i18n/locales/en.json` **and** `ar.json` (Egyptian colloquial, full key parity). No npm
script — verify the keysets match before committing.

### Security review of the incoming diff (treat GLM's code as untrusted input)

Walk the diff against the `CLAUDE.md` §12 quick-reject list. Any hit blocks the PR:

- [ ] No `disable row level security` anywhere.
- [ ] No service-role key client-side; nothing secret bundled under `EXPO_PUBLIC_*`.
- [ ] No hardcoded secrets / API keys (gitleaks backs this up, but eyeball it too).
- [ ] No `{...req.body}` / `Object.assign(row, body)` spreads into a DB update — fields allowlisted.
- [ ] No string-concatenated SQL — parameterized / Supabase client only.
- [ ] New table ⇒ RLS enabled **+ policies in the same migration** + cross-tenant denial test.
- [ ] New `supabase/migrations/NNNN_*.sql` ⇒ **added to `supabase/tests/rls/runner.ts`** (its
      migration list is hardcoded — a missing entry silently skips the migration).
- [ ] Money = integer minor units + explicit `currency`; never floats. Timestamps `timestamptz`, UTC.
- [ ] Generic errors to the client; no raw DB errors / stack traces leaked.

### Push + open the PR

```bash
git push -u origin slice-3-food-prefs
# then open the PR (gh pr create --fill, or ask Claude Code to open it via the GitHub tools)
```
CI (`.github/workflows/ci.yml`) runs **gitleaks + npm audit + test:rls** automatically on the PR.

---

## Step 4 — Feedback back to GLM

- Relay PR review comments to GLM, **or** GLM reads them straight off the public PR.
- For the next patch, GLM branches off the **same** base (or the agreed updated base) to avoid
  conflicts. Rebase between rounds rather than letting branches drift.

---

## Last resort — direct token push from z.ai (NOT recommended)

Documented only so you don't improvise something worse. This puts a **live write credential into
z.ai's chat transcript** — strictly weaker than the patch flow, and it buys you almost nothing
since the patch flow is already parallel. Use only for a throwaway change, and only if you accept
the token as **burnable**:

1. **Fine-grained PAT** — Resource owner `moazessam376-dev`, repo = **`gym-app` only**,
   permission **Contents: Read and write** only, **expiry 1 day**.
2. Paste it into a **fresh** z.ai session; GLM exports it for that shell only.
3. **Revoke it the instant the push lands** (GitHub → Settings → Developer settings → revoke).
4. First **protect `main` + the base branches** with a ruleset, and tick **"Do not allow
   bypassing the above settings" / include administrators** — the token acts as you (the owner/
   admin), so without admin-inclusion the protection is theater and a leak could clobber `main`.

GLM's push, with the token in an env var (never written to chat):
```bash
git push "https://x-access-token:${GH_TOKEN}@github.com/moazessam376-dev/gym-app.git" slice-n-...
```

**Prefer the patch flow.** This section is a break-glass option, not the plan.
