# Phase 3 — Training & nutrition plans

Maps to CLAUDE.md §2 (tenancy) and §4 (Zod-validated, allowlisted mutations).
Depends on Phase 2 (coach ⇄ client link via `profiles.coach_id`).

## Goal
A coach authors **plans** for their own clients; the assigned client reads only
the plans meant for them, once published. Same deny-by-default tenancy as the
rest of the app — a coach can only touch plans for a client where
`is_coach_of(client_id)`, and a client can never write a plan.

## Model — unified plans + items
One table per concept, with a `type` discriminator (extensible to a third type
later with no new tables):

- `plans`: `id`, `coach_id` (author), `client_id` (assignee), `type`
  (`training | nutrition`), `title`, `status` (`draft | published | archived`),
  `version`, timestamps.
- `plan_items`: `id`, `plan_id`, `position` (ordering), `name`, `notes`,
  `payload` (jsonb — type-specific structured fields, Zod-validated in the app
  and Edge layer). Cascade-deletes with its plan.

Money/units discipline still applies anywhere numbers appear (no floats for
counts; see `.claude/rules/money.md` spirit) — `payload` holds structured ints.

## RLS (deny-by-default)
- **plans**
  - select: coach where `coach_id = auth.uid()`; client where
    `client_id = auth.uid() AND status <> 'draft'` (drafts stay private to the
    coach; published/archived are visible to the client); admin all.
  - insert/update: coach only, `coach_id = auth.uid() AND current_app_role() =
    'coach' AND is_coach_of(client_id)` — can't author for a non-client.
  - delete: coach (`coach_id = auth.uid()`) or admin. Clients never write.
- **plan_items** — ownership flows from the parent plan via `SECURITY DEFINER`
  helpers (avoid re-entering `plans` RLS / recursion, same pattern as
  `is_coach_of`):
  - `can_read_plan(plan)` — coach owner, assigned client (non-draft), or admin.
  - `can_write_plan(plan)` — coach owner only.
  - select uses `can_read_plan`; insert/update/delete use `can_write_plan`.

## Zod
`createPlan`, `updatePlan`, `createPlanItem`, `updatePlanItem` — allowlist fields
only (no `req.body` spread, §4). `coach_id`/`version` are server-controlled.

## Slices
1. **Schema + RLS + harness** (`0009_plans.sql`): tables, policies, helpers,
   seed, and cross-tenant tests. ← this slice.
2. **Coach plan builder**: create/edit a plan for a client, add items, publish.
3. **Client plan viewer**: read your published plans.

## Acceptance / tests (harness)
- Coach A reads their own clients' plans, not Coach B's.
- Client A1 reads their **published** plan, **not** a draft, not another
  client's plan, and **cannot** insert/update a plan.
- Coach A cannot create a plan for a client who isn't theirs (Client B1).
- plan_items inherit: client reads items of their published plan only; coach
  writes items only on plans they own; cross-tenant denied.

## Out of scope
Versioning workflow beyond a `version` column (republish/version-bump logic is a
later refinement), AI plan generation (Phase 7), media attachments (Phase 4).
