# Phase 10 — Athlete food & macro logging  `[MVP]`

> Completes the **daily athlete loop**. Training logging is already live (0016);
> this adds the other half: the athlete logs what they ate, and both sides see
> daily calories/macros against a **personalized target seeded from Phase 9 goals**.
> Read [foundations.md](./foundations.md) first — this phase obeys its §1 (tenancy),
> §3 (integer units), §4 (rate-limit), §7 (personalization spine) and §8 (DoD).

Migration number: **`0019_food_logging.sql`** (latest on `main` is 0018).

## Locked decisions (founder, 2026-06-21)
- **Targets:** auto-estimate from the Phase 9 profile **+ coach override** (not
  coach-only, not athlete-only). A 4th source — **from the assigned nutrition
  plan** — is also supported (the coach already prescribed macros).
- **Navigation:** a dedicated client **Nutrition tab**; nutrition info **also
  surfaced on Home** (ring + remaining + streak + weekly average).
- **Value features IN this phase:** (1) quick-logging kit (recent foods, copy a
  day, remaining macros), (2) nutrition streak + weekly average, (3) coach
  adherence view, (4) targets-from-assigned-plan, (5) **off-plan logging** — an
  entry can fulfil a prescribed meal item *or* be an extra ("ate something outside
  the day's meals"); macros are computed and counted either way.
- **Deferred to a fast-follow:** saved-meal combos + per-food serving presets.

---

## 1. Where this sits in the product spine

The MVP core loop is *coach assigns plan → athlete logs training **+ food** → both
see progress → they chat.* Food logging is the missing verb on the nutrition side,
mirroring what `workout_sessions` did for training. It **reuses** the existing
`food_library` (0010) — global rows + a coach's customs — so we are not building a
food database, only the **diary** on top of it.

What's already in place we build on:
- `food_library(name, kcal_per_100g, protein_g_per_100g, carbs_g_per_100g,
  fat_g_per_100g)` — integer macros per 100 g, RLS = globals + own customs.
- `athlete_profile(sex, birth_date, height_cm, target_weight_grams, activity_level,
  primary_goal)` — the **personalization contract** (Phase 9, foundations §7) that
  seeds calorie/macro targets.
- `progress_entries.weight_grams` — latest = the athlete's **current** body weight,
  the input TDEE needs (target weight is the goal, not the current mass).
- The `plan_meal_items` **macro-snapshot** pattern (snapshot per-100g macros + a
  `food_name` display snapshot at write time) so a diary row renders and totals
  compute without re-reading `food_library`, and is stable if the library is later
  edited/deleted.

---

## 2. Data model (migration `0019`, tables + RLS in the same migration)

Two tables + one enum + one view. All integers (foundations §3). Idempotent so it
can be re-pasted into the SQL editor (the project convention).

### 2a. `meal_slot` enum
`create type public.meal_slot as enum ('breakfast', 'lunch', 'dinner', 'snack');`
(guarded `do $$ … if not exists …$$`).

### 2b. `food_log_entries` — the diary (client-owned)

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid → profiles | **owner**; `= auth.uid()` (§1 client-owned). Server-set by trigger. |
| `log_date` | date not null | device-local calendar day this food counts toward; default `(now() at time zone 'utc')::date` fallback (§11). |
| `meal_slot` | `public.meal_slot` not null | breakfast/lunch/dinner/snack. |
| `food_id` | uuid → food_library `on delete set null` | NULL = a one-off quick-add not in the library. |
| `plan_meal_item_id` | uuid → plan_meal_items `on delete set null` | **off-plan link** (mirrors `exercise_set_logs.plan_exercise_id`): set = this entry fulfils a prescribed meal item; **NULL = an off-plan extra** ("ate something outside the day's meals"). Informational for prescribed-vs-actual; the macro **snapshot** is authoritative for totals (so a loose FK is fine and no cross-table RLS join is needed on insert). |
| `food_name` | text not null | **display snapshot** (plan_meal_items pattern) — survives a library edit/delete. |
| `kcal_per_100g` | integer not null default 0, `>= 0` | **macro snapshot** at log time. |
| `protein_g_per_100g` | integer not null default 0, `>= 0` | |
| `carbs_g_per_100g` | integer not null default 0, `>= 0` | |
| `fat_g_per_100g` | integer not null default 0, `>= 0` | |
| `grams` | integer not null, `>= 0` | portion eaten, **integer grams** (never float). |
| `note` | text | |
| `created_at` / `updated_at` | timestamptz, UTC | `set_updated_at` trigger. |

Per-entry macros are derived, never stored: `grams * kcal_per_100g / 100` etc.
Index: `(user_id, log_date)` for the daily roll-up; `(food_id)` for FK.

**RLS = the pure "Client-owned" shape** (foundations §1, same as `progress_entries`):
- SELECT: `user_id = auth.uid() OR public.is_coach_of(user_id) OR current_app_role() = 'admin'`.
- INSERT: `with check (user_id = auth.uid())`.
- UPDATE / DELETE: **owner only** (`user_id = auth.uid()`).
- **Coach reads, coach does not edit** the athlete's diary (deliberately stricter
  than `workout_sessions`, which let a coach annotate — feedback on food goes via
  chat / coach notes, not by mutating the athlete's log).
- Grants: `select` to `anon, authenticated` (anon → 0 rows via RLS); `insert,
  update, delete` to `authenticated`.

**Rate-limit (foundations §4, reuse the `messages` trigger shape):** a
`BEFORE INSERT` trigger `handle_food_log_insert()` (SECURITY INVOKER, `set
search_path = ''`, schema-qualified) that:
1. passes through untouched for `service_role` and the seed/superuser path
   (`auth.uid()` null);
2. **forces `new.user_id := auth.uid()`** (server owns the owner identity, never
   trust a client value) — belt-and-suspenders with the INSERT policy;
3. caps inserts to **40 per rolling 10 s** per user (`raise exception
   'rate_limited' using errcode = 'P0001'`). Generous enough for adding a multi-item
   meal in a burst; blocks runaway loops / spam.

### 2c. `nutrition_targets` — the daily goal (one current row per athlete)

The roll-up compares against this. Auto-seeded from `athlete_profile` (§3 below),
editable by the athlete, **overridable by their coach** (this is a coaching app).

| column | type | notes |
|---|---|---|
| `user_id` | uuid pk → profiles | one current target per athlete (upsert). |
| `kcal_target` | integer not null, `>= 0` | |
| `protein_g_target` | integer not null, `>= 0` | grams. |
| `carbs_g_target` | integer not null, `>= 0` | grams. |
| `fat_g_target` | integer not null, `>= 0` | grams. |
| `source` | `public.target_source` enum (`auto_estimated \| self_set \| coach_set \| from_plan`) | provenance: TDEE estimate · athlete-typed · coach-overridden · **computed from the assigned nutrition plan's prescribed macros**. |
| `set_by` | uuid → profiles | who last wrote it (athlete or coach); server-set. |
| `created_at` / `updated_at` | timestamptz, UTC | |

**RLS = client-owned, but coach may also write** (the override path — same as the
`workout_sessions` UPDATE policy that admitted the coach):
- SELECT: `user_id = auth.uid() OR is_coach_of(user_id) OR admin`.
- INSERT / UPDATE: `with check (user_id = auth.uid() OR public.is_coach_of(user_id))`
  (and matching `using` on update). `set_by` is forced to `auth.uid()` by the same
  BEFORE trigger pattern; `user_id` is immutable (the row key).
- DELETE: owner only (rarely used).

> History/versioning of targets is **deferred** (post-MVP). One current row keeps
> the roll-up simple; foundations §7 "versioned" is satisfied at the *profile*
> layer, which is the cross-pillar contract. We can add a `nutrition_target_history`
> append row later without touching readers.

### 2d. `v_daily_nutrition` — the roll-up view (SECURITY INVOKER)

Mirrors `v_session_adherence`: a `with (security_invoker = true)` view so the
**querying user's** base-table RLS applies (athlete sees own days, coach sees their
clients'). Groups `food_log_entries` by `(user_id, log_date)`:

```
kcal_total    = round(sum(grams * kcal_per_100g)      / 100.0)::int
protein_total = round(sum(grams * protein_g_per_100g) / 100.0)::int
carbs_total   = round(sum(grams * carbs_g_per_100g)   / 100.0)::int
fat_total     = round(sum(grams * fat_g_per_100g)     / 100.0)::int
entry_count   = count(*)
```
(sum-then-divide once to minimise rounding; output integers, §3.)

Targets are **not** joined into the view (they live per-user, not per-day, and we
want the target to show on a day with zero entries). The app reads
`nutrition_targets` (one row) + `v_daily_nutrition` for the date (0 rows → treat as
0 consumed) and renders consumed-vs-target client-side.

No cross-tenant aggregation here, so **no SECURITY DEFINER function is needed** this
phase (unlike `coach_leaderboard`). The only reads are owner/coach, already covered
by RLS + the invoker view.

### 2e. `nutrition_streak(p_user default auth.uid())` — habit metric (SECURITY INVOKER)

Exact reuse of `current_streak` (0016): gaps-and-islands over **distinct
`log_date` that have ≥1 entry**, returning the consecutive-day run ending
today/yesterday (1-day grace). SECURITY INVOKER, `set search_path = ''`, filters to
`p_user` and relies on `food_log_entries` RLS — so a coach calling it for their
client is gated exactly like a direct read. `revoke from public/anon; grant execute
to authenticated, service_role`. Drives the Home streak chip and is the coach's
"is my athlete logging?" compliance signal.

> **Weekly average** is computed app-side from the last 7 rows of
> `v_daily_nutrition` (no extra DB object) — see §4.

---

## 3. Target estimation (pure TS, client-side) — seeded from Phase 9

`estimateTargets(profile, currentWeightGrams)` in `src/lib/nutrition.ts`. It is a
**suggestion** the athlete/coach accepts or edits — not security-sensitive — so it
lives in TS (easy to tune), and only the **accepted** values get written to
`nutrition_targets`. Formula (all inputs from the personalization contract):

1. **BMR — Mifflin-St Jeor** (needs current weight kg, height cm, age, sex):
   - male:   `10*kg + 6.25*cm − 5*age + 5`
   - female: `10*kg + 6.25*cm − 5*age − 161`
   - `kg` = latest `progress_entries.weight_grams` / 1000 (fallback:
     `target_weight_grams` if no weight logged yet); `age` from `birth_date`.
2. **TDEE** = BMR × activity factor: sedentary 1.2 · light 1.375 · moderate 1.55 ·
   active 1.725 · very_active 1.9.
3. **Goal adjustment** on TDEE → `kcal_target`: lose_fat −20% · build_muscle +10% ·
   gain_strength +8% · sport_performance +5% · maintain/improve_health 0%.
4. **Macro split:** protein `2.0 g/kg` bodyweight (1.8 for maintain/health) · fat
   `25%` of kcal ÷ 9 · carbs = remaining kcal ÷ 4. Round every output to integer
   grams / integer kcal.

If `sex / height_cm / birth_date / weight` are missing, return `null` and the UI
prompts the athlete to finish their profile (links to `profile-setup`) instead of
guessing.

**Alternative source — the assigned nutrition plan (`from_plan`).** Nutrition plans
are flat `Plan → plan_meals → plan_meal_items` (confirmed: 0014 keeps nutrition
out of weeks/days). `plannedDailyMacros(planId)` sums each item's
`grams * *_per_100g / 100` across the athlete's **assigned, published** nutrition
plan → a prescribed daily kcal/macro total. The UI offers "Use my plan's targets"
when such a plan exists; accepting writes `nutrition_targets` with
`source: from_plan`. This is the prescribed side of prescribed-vs-actual.

---

## 4. Data layer & schemas (allowlisted, foundations §2)

- **`src/schemas/nutrition.ts`** (new):
  - `mealSlotSchema = z.enum(['breakfast','lunch','dinner','snack'])`.
  - `targetSourceSchema = z.enum(['auto_estimated','self_set','coach_set'])`.
  - `targetSourceSchema = z.enum(['auto_estimated','self_set','coach_set','from_plan'])`.
  - `createFoodLogSchema` — allowlist only: `log_date?` (ISO date), `meal_slot`,
    `food_id?` (uuid nullable), `plan_meal_item_id?` (uuid nullable — off-plan
    link), `food_name` (1..120), the four per-100g macros (int, bounded as in
    `createFoodSchema`), `grams` (int 0..5000), `note?` (≤500). **`user_id` is NOT
    in the schema** (server-set by trigger).
  - `updateFoodLogSchema` — partial of the mutable fields (grams, meal_slot, note,
    macros, food_name); never `user_id`.
  - `upsertTargetsSchema` — `kcal_target` (int 0..10000), the three macro targets
    (int 0..1000), `source`. `user_id` / `set_by` server-set.
- **`src/lib/nutrition.ts`** (new), following `src/lib/sessions.ts`:
  - `listFoodLog(userId, date)` · `addFoodLog(userId, input)` · `updateFoodLog(id,
    input)` · `deleteFoodLog(id)`.
  - `getDailyNutrition(userId, date)` from `v_daily_nutrition` (coerce bigint→number
    like `getAdherence` does); `getWeekNutrition(userId, endDate)` → last 7 days +
    the **weekly average** (app-side reduce, integers out).
  - `getTargets(userId)` · `upsertTargets(userId, input)`.
  - `estimateTargets(profile, currentWeightGrams)` (§3) — pure, no I/O.
  - `plannedDailyMacros(planId)` — sums the assigned nutrition plan's items
    (`from_plan` source); `getAssignedNutritionPlan(userId)` to find it.
  - `getNutritionStreak(userId?)` → `nutrition_streak` RPC (coerce to number).
  - **Quick-logging kit:** `recentFoods(userId, limit)` — distinct recent
    `food_log_entries` for the user ordered by recency/frequency (no schema change);
    `copyDay(userId, fromDate, toDate)` — re-inserts a previous day's entries under
    a new date (re-snapshots macros, re-links `plan_meal_item_id`).
  - `mealMacros(entry)` / `sumMacros(entries)` helpers for per-row + section totals;
    `remaining(consumed, target)` for the remaining-macros display.
  - **Reuse** `listFoods()` from `src/lib/library.ts` for the picker; on pick,
    snapshot the food's name + per-100g macros into the new entry.

---

## 5. UI

A daily-use core-loop surface, styled in the existing design system (Neon Glassy
Dark primitives in `src/components/ui/`). Screens/flows:

1. **Nutrition tab (client only)** — `app/(tabs)/nutrition.tsx` (confirmed: new
   tab; bottom bar becomes **Home · Plans · Nutrition · Progress · Messages**, with
   Account reached from the Home header avatar — already a linkable route):
   - **Hero calorie ring** (reuse `ProgressRing`): kcal consumed vs `kcal_target`,
     with the **remaining** figure; three macro bars (protein/carbs/fat consumed vs
     target) showing **remaining** each.
   - **Meal-slot sections** (Breakfast / Lunch / Dinner / Snack) listing the day's
     entries (food_name · grams · kcal), each with per-row macros and an **off-plan
     badge** when `plan_meal_item_id` is null; swipe/long-press to edit/delete
     (owner-only).
   - **Date strip** to scroll back over previous days (reads `v_daily_nutrition` +
     `food_log_entries` for the chosen date).
   - **Targets card**: if no `nutrition_targets` row, offer **"Use my plan's
     targets"** (when an assigned nutrition plan exists, `from_plan`) and/or the
     `estimateTargets` suggestion with an *Accept* CTA (`auto_estimated`); always
     allow manual edit (`self_set`). Empty-profile → nudge to `profile-setup`.
2. **Add-food flow** — `app/food/add.tsx` (pushed over tabs, like the workout
   logger): pick meal slot → **food picker** (reuse `listFoods()` / the existing
   `food-picker` UI pattern) with a **Recent foods** shortcut row (`recentFoods`) at
   the top, **or** quick-add a one-off / **off-plan** item (name + per-100g macros,
   `food_id` + `plan_meal_item_id` null) → enter grams → live macro preview → save.
   A **"Copy a previous day"** action (`copyDay`) seeds today from any past date.
3. **Home dashboard nutrition surface** (founder ask) — on `ClientHome`, alongside
   the training ring: a **"Nutrition today"** card with a compact kcal ring +
   remaining macros, the **nutrition streak** chip (`nutrition_streak`), and the
   **7-day average vs target**; tapping it opens the Nutrition tab. Makes the daily
   loop visible without a tab switch.
4. **Coach adherence view** — the coach's client-detail (`app/coach/client/[id].tsx`)
   gains a read-only **Nutrition adherence** card (coach already reads via RLS):
   today's consumed-vs-target, **% of days logged this week**, weekly average, and
   the nutrition streak — replacing more SAMPLE data with real compliance signal.

---

## 6. RLS test harness (build gate, foundations §8 / CLAUDE.md §11)

- Add `'0019_food_logging.sql'` to `migrationFiles` in
  `supabase/tests/rls/runner.ts`.
- **Seed** (`supabase/tests/rls/seed.sql`): Client A1 (Coach A) gets a
  `nutrition_targets` row + 2 `food_log_entries` for `current_date`; Client B1
  (Coach B) gets 1 entry — so cross-tenant denial and the daily view are exercised.
  (Use a global `food_library` row already seeded by 0010, plus one quick-add with
  `food_id` null.)
- **`describe('food logging (0019)')`** in `cases.test.ts`:
  - cross-tenant denial: Coach B sees 0 of A1's entries; Client A2 sees 0 of A1's;
    anon sees 0 (entries, targets, view).
  - positive controls: A1 reads own entries + targets; Coach A reads A1's entries,
    targets, and `v_daily_nutrition` rows.
  - forged-owner INSERT rejected (A2 inserting an entry with `user_id = A1` fails /
    is coerced away by the trigger → A2's own row, never A1's).
  - targets write: A1 upserts own; **Coach A** may upsert A1's (override path);
    Coach B may **not**; client cannot move `user_id`.
  - `v_daily_nutrition` is tenant-scoped (A1 + Coach A see A1's totals; B-side 0).
  - `nutrition_streak`: A1 and Coach A get A1's streak; an outsider/anon gets 0
    (mirrors the `current_streak` test).
  - off-plan link: an entry with `plan_meal_item_id` null is allowed (extra); a set
    link is stored but does not widen visibility (still owner/coach only).
- `npm run test:rls` (CI, Postgres 16 — no local Postgres on this machine) must be
  green; the "every public table has RLS enabled" invariant auto-covers both new
  tables.

---

## 7. Definition of done (foundations §8)

1. ✅ `food_log_entries` + `nutrition_targets` ship with deny-by-default RLS **in
   0019**; the daily view is SECURITY INVOKER; no new DEFINER function needed.
2. ✅ Every mutation has a Zod allowlist (`src/schemas/nutrition.ts`) + a thin data
   layer (`src/lib/nutrition.ts`); **all units integer** (grams, kcal, macro grams).
3. ✅ Rate-limit on `food_log_entries` insert (40/10 s) via the reused `messages`
   trigger shape; server-forced `user_id`/`set_by`.
4. ✅ RLS harness extended (cross-tenant denial + owner/coach positive controls +
   forged-owner rejection + view tenancy) and **green in CI**.
5. ✅ `get_advisors` shows no new findings beyond the accepted SECURITY-DEFINER-
   helper pattern + the pre-existing `auth_leaked_password_protection`.
6. ✅ Validated on a real DB (CI on Postgres 16); migration applied to prod via MCP
   **after CI is green** (the established workflow).

## 8. Out of scope (sequences outward)
- Barcode scan / external food API import (later; the `food_id`-null quick-add is
  the manual path now).
- Target **history/versioning** and per-day target snapshots (deferred above).
- AI macro estimation from a meal photo (L3 — reuses the §5 media pipeline +
  human-in-the-loop confirm).
- Coach *editing* an athlete's diary entries (intentionally owner-only; coach
  feedback goes via chat / coach notes).
