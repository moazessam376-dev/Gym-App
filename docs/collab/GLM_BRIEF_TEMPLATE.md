# GLM brief — template

Claude Code fills this in per task; the owner pastes the **filled** copy into GLM at the
start of a GLM session. Replace every `<…>` placeholder. Keep it self-contained — GLM
starts cold and only knows what's in the repo + this brief.

> Claude Code: output the filled brief in chat for the owner to copy. Optionally save a
> record under `docs/collab/briefs/<task>.md`. Always set the **base commit SHA** to the
> current `main` (or the branch GLM should build on) so the returned diff applies cleanly.

---

```
You are GLM, working IN PARALLEL with Claude Code on the Gym-App repo (you cloned it).
Claude Code handles all GitHub/database/deploy work and will review and integrate your
change — you only produce a diff.

STEP 0 — READ FIRST (you do not auto-load these):
  1. AGENTS.md
  2. CLAUDE.md  ← the constitution; it OVERRIDES this brief. If anything here conflicts
     with it, STOP and say so instead of working around it.
  3. .claude/rules/ — read the ones your task touches (rls.md, migrations.md,
     secrets.md, money.md).
  4. docs/phases/foundations.md and docs/phases/<your-phase-spec>.md
  5. docs/collab/WORKFLOW.md (your output format + the collision rules).

YOUR TASK: <one-line goal>
PHASE / SPEC: <docs/phases/phase-XX-….md, or section>
SCOPE (what to build): <concrete, bounded description of the slice>

FILES YOU MAY TOUCH:
  - <path/…>
  - <path/…>

FILES YOU MUST NOT TOUCH (owned by Claude Code / collision hot-spots this window):
  - supabase/migrations/*  and supabase/tests/rls/runner.ts   (DB numbering + apply list)
  - supabase/functions/*                                       (Edge Functions + deploy)
  - package.json / package-lock.json                           (deps — unless told below)
  - src/i18n/locales/en.json + ar.json  → ONLY if your task adds copy, and then edit BOTH
    together with full key parity; otherwise leave them alone.
  - <anything else Claude Code is editing in parallel this window>

HARD RULES (full detail in CLAUDE.md — these are non-negotiable):
  - Never disable RLS. New table ⇒ its RLS policies in the SAME migration. (Default: you
    do NOT author migrations — see "DATABASE" below.)
  - No secrets/API keys in code; never the service-role key client-side; only EXPO_PUBLIC_*
    is safe in app code.
  - Money = integer minor units + a currency field; measured values are integers
    (e.g. weight_grams). Never floats.
  - Every mutating path validates input with a Zod schema (allowlist fields; never spread
    req.body). Never string-concatenate SQL.
  - Tokens in Expo SecureStore, never AsyncStorage. No public buckets for user data.
  - Every user-facing string goes through t() with BOTH en.json + ar.json (parity), RTL-safe.
  - Don't install a package without confirming it exists on npmjs.com.

DATABASE: <"None — UI/app-layer only." OR "You DO need a migration: name it
  NNNN_PLACEHOLDER_<desc>.sql; Claude Code assigns the real number and updates runner.ts.
  Ship RLS policies in the same file; add a cross-tenant denial test.">

DONE WHEN:
  - <task-specific acceptance, e.g. "food diary screen lists entries by day and shows the
    macro ring vs target from the Phase 9 goals">
  - TypeScript compiles (tsc); en/ar key parity holds if you added copy.
  - You changed ONLY files in the allowed scope.

OUTPUT (required):
  - Produce ONE unified diff against base commit <SHA> (git-diff style, a/ b/ paths from
    repo root; new files shown in full). Cover only your scoped files.
  - Do NOT run git push or open a PR. Hand the diff to the owner to give to Claude Code.
  - If you hit something that needs a migration, an Edge Function, a new dependency, or a
    forbidden file, STOP and describe it in plain text instead of doing it.
```

---

### Filling tips for Claude Code
- **Base SHA** = current `main` (`git rev-parse --short origin/main`) unless GLM is
  layering on an unmerged branch; then use that branch's tip and say so.
- **Scope tightly.** GLM is reliable on one bounded, self-contained slice; don't hand it
  multi-system work in one brief (mirror the `CLAUDE.md §9` "one reliable unit" discipline).
- **Pre-resolve the forbidden list** against what *you* are editing in parallel so the two
  diffs never overlap (see `WORKFLOW.md §5`).
- After GLM returns the diff, integrate per `WORKFLOW.md §4` and run the review gate (§6).
