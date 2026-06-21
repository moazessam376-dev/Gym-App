# Phase 9 — Profiles + Questionnaire + Goals

> The personalization **foundation**. Athlete goals + coach profile are captured
> once and **read by later pillars**: macro/calorie targets (Phase 10), progress
> framing (Phase 11), rank context (Phase 12). Obeys
> [foundations.md](./foundations.md): client-owned RLS, integer units, Zod allowlists.
>
> **MVP.** Depends on Phase 8. Spec status: ready to build.

## Goal
A new client/coach completes a short questionnaire so the app knows who they are
and what they want. Two owner-scoped tables; a role-branched setup/edit screen; a
"complete your profile" nudge. **Not** guard-forced (avoids touching the auth
redirect) — promptable from home + editable from Account.

## Data model — migration `0017_profiles_goals.sql`

Both tables: PK = `user_id` (one row per user), `enable row level security` +
policies in the same migration, `set_updated_at` trigger. Integer units only.

### `athlete_profile` (one per client)
```
user_id              uuid PK references public.profiles(id) on delete cascade
primary_goal         public.athlete_goal            -- enum (below), nullable until answered
experience_level     public.experience_level        -- enum, nullable
sex                  public.sex                      -- enum, nullable (for TDEE est. in P10)
birth_date           date                            -- nullable (age → TDEE)
height_cm            integer  check (>0 and <300)    -- integer (foundations §3)
target_weight_grams  integer  check (>0)             -- integer grams
activity_level       public.activity_level           -- enum, nullable (TDEE multiplier)
training_days        integer  check (between 0 and 7)
dietary_tags         text[]   default '{}'           -- allowlisted tags (Zod), e.g. vegetarian/halal
injuries_notes       text                            -- free text
onboarded_at         timestamptz                     -- set when the questionnaire is first completed
created_at/updated_at timestamptz
```
Enums: `athlete_goal` (`lose_fat | build_muscle | maintain | gain_strength |
improve_health | sport_performance`), `experience_level` (`beginner | intermediate
| advanced`), `activity_level` (`sedentary | light | moderate | active |
very_active`), `sex` (`male | female | other | prefer_not_to_say`).

### `coach_profile` (one per coach)
```
user_id          uuid PK references public.profiles(id) on delete cascade
bio              text
specialties      text[]  default '{}'    -- allowlisted tags (hypertrophy/powerlifting/nutrition/…)
years_experience integer check (>=0 and <80)
certifications   text
onboarded_at     timestamptz
created_at/updated_at timestamptz
```

### RLS (deny-by-default; reuse existing helpers — no new SECURITY DEFINER needed)
- **`athlete_profile`** (mirrors the client-owned shape):
  - SELECT: `user_id = auth.uid() OR public.is_coach_of(user_id) OR current_app_role()='admin'`
  - INSERT/UPDATE/DELETE: owner only (`with check (user_id = auth.uid())`). Coach
    reads (to tailor plans) but doesn't write the athlete's self-report.
- **`coach_profile`**:
  - SELECT: `user_id = auth.uid() OR user_id = public.my_coach_id() OR admin`
    (a client can read THEIR coach's profile via `my_coach_id()`).
  - INSERT/UPDATE/DELETE: owner only.
- Grants: `select to anon, authenticated` (anon→0 via RLS); `insert, update, delete
  to authenticated`. `role`/identity are immutable — there's nothing here that
  changes ownership/role, so no extra trigger needed.

## Data layer + schemas
- `src/schemas/athlete-profile.ts`, `src/schemas/coach-profile.ts` — Zod
  allowlists. `dietary_tags`/`specialties` validated against an enum-of-tags array.
  Integer fields `.int()`. Partial-update schemas (questionnaire saves incrementally).
- `src/lib/athlete-profile.ts` (`getMyAthleteProfile`, `getAthleteProfileFor(clientId)`
  for coaches, `upsertAthleteProfile`, `markOnboarded`), `src/lib/coach-profile.ts`
  (`getMyCoachProfile`, `getCoachProfileFor(coachId)`, `upsertCoachProfile`).
  Upserts allowlist fields; `onboarded_at` set server-side on first complete.

## Screens (design-system, blue glassy)
- **`app/profile/setup.tsx`** — role-branched questionnaire/goals editor (athlete vs
  coach questions). Reused for first-time onboarding AND later editing. Segmented/Chip
  for enum pickers, Input for numbers, integer parsing (grams/cm). On submit → upsert
  + `markOnboarded`.
- **Account tab** (`app/(tabs)/account.tsx`) — add a "Goals & profile" row + a small
  "complete your profile" hint when `onboarded_at` is null.
- **Client home** (`ClientHome`) — a dismissible prompt card when not onboarded
  ("Set your goals so your coach can tailor your plan" → setup).
- **Coach client detail** (`app/coach/client/[id].tsx`) — show the client's goals
  (read-only) so the coach can tailor plans. Replaces some SAMPLE data with real
  goal data where available.

## RLS test additions (the build gate, §11)
Add `0017_profiles_goals.sql` to `runner.ts`; seed an `athlete_profile` for a Coach-A
client + a `coach_profile` for Coach A; add a `describe('profiles & goals (0017)')`
block: cross-tenant denial (Coach B can't read A1's athlete_profile; client can't read
a sibling's; anon→0), owner + coach positive controls, a client reads THEIR coach's
`coach_profile` but not another coach's, forged-owner insert rejected. `npm run
test:rls` green.

## Personalization contract (what later phases read)
- **Phase 10** reads `sex, birth_date, height_cm, target_weight_grams,
  activity_level, primary_goal` to seed TDEE + macro/calorie targets.
- **Phase 11/12** read `primary_goal` + `target_weight_grams` to frame progress and
  rank context. Treat this table's columns as a stable contract — additive changes only.

## Definition of done (foundations.md §8)
Tables + RLS in one migration; Zod allowlists + integer units; RLS harness extended &
green in CI; `get_advisors` clean; applied to prod via MCP after CI green; tested
on-device (complete questionnaire → coach sees goals on client detail).
