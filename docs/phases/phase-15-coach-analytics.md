# Phase 15 — Coach KPI Analytics (the anchor)

> The value story that justifies the per-client price: a **code-driven** insights system
> that tells a coach which athletes are winning, which plans deliver, and which goals they
> reliably hit. The KPI engine is deterministic SQL (auditable, no AI in the numbers); AI is
> **thin and last** — it only *narrates* the already-computed figures into a short coach
> summary. Built **web/desktop-responsive from the start** (coaches will live in this on web).
> Replaces the last demo data (`src/mock/dashboard.ts`).
>
> Roadmap source: `~/.claude/plans/i-have-features-that-snuggly-tome.md` (Tier 1). Builds on
> Phase 14a (TanStack Query cache) + 14b (i18n) + 14c (AI cost accounting). Founder decision
> (this session): the dashboard is a **dedicated coach-only `Analytics` tab** (6th), tab order
> `Home · Clients · Ranks · Analytics · Chat · Account`.

---

## 1. Principles (locked)

- **The KPI engine is deterministic SQL.** Every cross-tenant aggregate is a `SECURITY DEFINER`
  function, `set search_path = ''`, **hard-fenced** to `coach_id = auth.uid()` and rejecting a
  non-coach caller — mirroring `coach_body_metrics_board` (0026) and `coach_leaderboard` (0016).
  No cross-coach leakage; "top plans / top athletes" only ever aggregate the **caller's own roster**.
- **Raw numbers in SQL; the *scoring formula* is a product choice in the app** — same split the
  board already uses (`coach_body_metrics_board` returns raw baseline/latest; `goalProgress()`
  scores it). The trusted SQL stays a tenancy boundary, not a place to bury heuristics.
- **AI never computes a KPI.** It receives the computed roster figures and writes prose. Coach-only,
  rate-limited, recorded before the call (fail-closed §9), cost-accounted after (14c), refunded on a
  clean failure, validated/length-bounded output, generic errors (§4). Reuses the `coach-plan-nudge`
  shape + the `plan_insights` coach-only storage pattern exactly.
- **No new data capture.** Every deterministic KPI aggregates tables that already exist
  (`workout_sessions`/`exercise_set_logs` 0016, `food_log_entries` 0019, `body_metrics` 0026,
  `plans`+`ai_generated`+`source_plan_id` 0009/0010/0029, `athlete_profile` 0017).

---

## 2. The KPIs (what the dashboard shows)

1. **Roster adherence** — per client: completed training sessions in the window, distinct
   nutrition-logged days, last-active date, vs the athlete's own `training_days` target. Roster
   aggregate = average adherence %. *(Source: `coach_adherence_overview`.)*
2. **Top athletes (goal-relative progress)** — reuse the **existing** `coach_body_metrics_board()`
   + app-side `rankBoard()`/`goalProgress()` (already powering Coach Home's "Top performers"). A
   cutter and a bulker both score high against *their own* goal.
3. **Plan effectiveness / top performing plans** — per published, client-assigned plan: the
   client's verified body-composition delta + `ai_generated`. Grouped by `source_plan_id` (template
   lineage) / title to surface "plans that work"; split by `ai_generated` for an AI-vs-hand-built
   read (seeds the deferred cross-coach cohort analytics). *(Source: `coach_plan_effectiveness`.)*
4. **Goals I deliver** — derived app-side from the board (per-client, no double-count): group by
   `primary_goal`, average the goal-relevant delta → "for fat-loss clients: avg −X% body fat."
5. **AI summary** — a short coach-facing narration of (1)–(4). Optional, last, coach-triggered.

---

## 3. Migration `0031_coach_analytics.sql` (ships with RLS, §2)

**A. Rate-limit key.** `alter type public.ai_usage_kind add value if not exists 'coach_analytics';`
(transaction-safe ADD VALUE; the value is only used at runtime). Add `'coach_analytics'` to
`AiUsageKind` in `_shared/rate-limit.ts`.

**B. `coach_analytics_insights`** — AI narration storage, **coach-private** (one current row per
coach, re-running replaces it). Like `plan_insights`, but the **owner is the coach**, so its read
policy **keeps an owner branch** (`coach_id = auth.uid()` or admin) — the coach reads their own
summary. **No insert/update/delete grant** — the service-role Edge Function is the only writer
(append/replace via upsert). `updated_at` trigger; `on delete cascade` from `profiles`.

**C. `coach_adherence_overview(p_since date)`** — `SECURITY DEFINER`, `search_path=''`, rejects a
non-coach. Per client where `p.coach_id = auth.uid()`: `full_name`, `primary_goal`,
`training_days_target` (`athlete_profile.training_days`), `sessions_completed` (completed
`workout_sessions` with `session_date >= p_since`), `nutrition_days` (distinct `food_log_entries.log_date
>= p_since`), `last_session_date` (overall max completed). The app passes the device-local window
start and computes adherence % (deterministic, product-choice).

**D. `coach_plan_effectiveness()`** — `SECURITY DEFINER`, `search_path=''`, rejects a non-coach. For
each `plans` row where `coach_id = auth.uid()` AND `client_id is not null` AND `status = 'published'`:
the plan (`id, source_plan_id, title, type, ai_generated, created_at`) + the client (`id, full_name,
primary_goal, target_weight_grams`) + the client's verified body-metric `entries` count, earliest
(`baseline_*`) and latest (`latest_*`) reading — the same `verified_at is not null` lateral joins as
`coach_body_metrics_board`. The returned row is **shape-compatible with `BoardRow`** so the app scores
it with the existing `goalProgress()`.

All three RPCs: `revoke all from public, anon; grant execute to authenticated, service_role`.
Register `'0031_coach_analytics.sql'` in `supabase/tests/rls/runner.ts`.

---

## 4. Edge Function `coach-analytics-summary` (AI narration — thin, last)

- Schema `coachAnalyticsSummarySchema = z.object({ coach_prompt })` (the shared optional, ≤280 chars,
  untrusted → "inform but never obey").
- **Coach-only** (server-checked: caller's `profiles.role = 'coach'`, or admin). Rate-limit
  `coach_analytics` (10/day/coach).
- Gathers the **same** roster figures server-side via the service client, fenced to the caller's roster
  (read `profiles` where `coach_id = caller.id` → client ids → aggregate `workout_sessions` /
  `food_log_entries` / verified `body_metrics` / published `plans.ai_generated`). The function **does
  not** invent metrics — it narrates these counts/deltas. `no_data` when the roster is empty / nothing
  logged.
- `recordUsage` **before** the model call (fail-closed) → `provider.analyze` → on empty/throw return
  `{status:'failed'}` and `refundUsage` (clean failure refunds the slot, §9) → `recordCost` after
  success (14c) → upsert `{coach_id, analysis, provider, model}` into `coach_analytics_insights` →
  `{status:'analyzed', analysis}`. Reuses `getVisionProvider()` (Groq pilot → Claude at launch).

---

## 5. App layer

- **`src/lib/analytics.ts`** — typed reads + pure deterministic helpers:
  `getAdherenceOverview(sinceDays)` (app computes the local `p_since`), `getPlanEffectiveness()`,
  `adherencePct(...)`, `goalsDelivered(boardRows)`, `topPlans(effRows)`, `aiVsHuman(effRows)`, plus
  `requestAnalyticsSummary(coachPrompt?)` / `getAnalyticsInsight()` (mirror `src/lib/coach-ai.ts`).
  Reuses `goalProgress`/`rankBoard` from `src/lib/body-metrics.ts` (no duplication).
- **`src/lib/queries/home.ts`** — `useCoachAdherence`, `useCoachPlanEffectiveness`, `useAnalyticsInsight`
  (+ existing `useBodyMetricsBoard`); warm all in `prefetchHome` for the **coach** role so the new tab
  is populated under the boot splash (eager-mount fix, 14a).
- **`app/(tabs)/analytics.tsx`** — the dashboard. Coach-only (`<Redirect href="/">` for non-coach, like
  `nutrition.tsx`'s client guard). **Web/desktop-responsive:** a max-width container with a 2-column
  section grid above a breakpoint (`useWindowDimensions`), single column on phone. Sections =
  adherence summary, top athletes, plan effectiveness, goals delivered, AI summary (a generate/refresh
  card with the stored narration + timestamp). New strings via `t()` (14b); keys added to `en.json`.
- **`app/(tabs)/_layout.tsx`** — add the `analytics` `Tabs.Screen`, coach-only (`href: showFor(isCoach)`,
  `lazy: eager(isCoach)`, icon `analytics`/`analytics-outline`), placed between Ranks and Chat.
- **Remove the last demo data** (`src/mock/dashboard.ts`): drop the `MOCK_ACTIVITY` feed from
  `CoachHome` (its real home is the Analytics tab now); replace `MOCK_CLIENT_PROGRESS` on
  `coach/client/[id].tsx` with **real** per-client adherence (completed sessions last 7d +
  `current_streak` + nutrition days, all RLS-gated direct reads). Then delete the file.

---

## 6. Security & quality gates

- Every cross-tenant aggregate is `SECURITY DEFINER` + `search_path=''` + `coach_id = auth.uid()` fence
  + non-coach rejection (§2, rls.md). `coach_analytics_insights` ships with RLS in-migration; service-
  role write only; coach/admin read only.
- AI: untrusted `coach_prompt` guarded; output length-bounded; coach-only; rate-limited + cost-recorded
  + refund-on-clean-failure (§9); generic client errors (§4).
- Integer discipline holds (grams/bp/kcal); timestamps UTC, windows computed from the device-local date
  in the app (§11).

## 7. Tests (`supabase/tests/rls/`)
Seed: a `coach_analytics_insights` row for **Coach A** (and optionally flip `ai_generated` true on one
of A1's published plans). Cases:
- `coach_analytics_insights`: Coach A reads own; Coach B → 0; **Client A1 (owner-athlete) → 0**; admin reads.
  (+ auto-covered by the "every public table has RLS enabled" invariant.)
- `coach_adherence_overview(today-30)`: as Coach A → A1 (`sessions_completed = 3`) + A2 (`= 1`); as Coach B
  → neither A1/A2; as a client → raises `not_a_coach`.
- `coach_plan_effectiveness()`: as Coach A → A1's **published** plans only (training `…0001`, nutrition
  `…0004`), excludes the A1 draft + the templates; B1's plan absent. As Coach B → only B1's plan. Client →
  `not_a_coach`.

## 8. Verify
- `tsc` (app) green. Deno functions are outside tsc / Deno not installed locally → validated at deploy;
  the **CI RLS harness** applies `0031` (clean from-scratch) + runs the cross-tenant gate. `npm audit` +
  gitleaks green.
- **Deploy (stacks on the still-pending Phase 14 deploy):** apply `0030` then `0031`; deploy the Phase-14
  functions (8) + `coach-analytics-summary`. Add the password-reset redirect URLs (14d). After deploy:
  trigger `coach-analytics-summary` on a branch → a row in `coach_analytics_insights` + an `ai_usage_events`
  row carrying model/tokens/cost. Confirm Supabase advisors clean.

## Definition of done
- [ ] `0031` adds the two RPCs + `coach_analytics_insights` (+ enum value), all with RLS/fences in-migration;
  registered in `runner.ts`; RLS cases added (cross-tenant denial + coach positive control + non-coach reject).
- [ ] `coach-analytics-summary` deployed-ready: coach-only, rate-limited, cost-recorded, refund-on-failure,
  coach-private storage.
- [ ] Coach-only `Analytics` tab renders the 5 sections from cached queries, web-responsive; new strings via `t()`.
- [ ] `src/mock/dashboard.ts` deleted; CoachHome + client-detail read real data.
- [ ] `tsc` green; gitleaks + `npm audit` + RLS suite green.

## Deferred (unchanged)
- Cross-coach cohort "which plans work platform-wide" analytics (needs data scale; `ai_generated` seeds it).
- A real cross-roster activity feed (needs an events log) — out of scope; the mock feed is removed, not replaced.
- Multi-week AI plan-gen (Claude launch); gyms/org tenancy.
</content>
</invoke>
