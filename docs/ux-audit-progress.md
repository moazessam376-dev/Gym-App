# Pre-Pilot UX Hardening — Progress Tracker

Living tracker for the pre-pilot program (plan: `~/.claude/plans/staged-floating-lampson.md`).
One source of truth for "what's left before pilot." Tick slices as they land.

Legend: ✅ done · 🔵 in progress · ⬜ not started · ⏸ deferred within scope (with a note)

## Already shipped (PR #42, before this program)
Account de-junk + `settings.tsx`; coach Invite/Templates → Clients tab; food prefs → Nutrition tab;
ClientHome trophy→leaderboards; plan delete; plan-editor draft discard; multi-plan switching
(`active_training_plan_id`, migration 0046 on prod); ScreenLoader + motion tokens.

## Slices
- ✅ **A — Workout blockers + coach-less Home CTA**
  - ✅ Bodyweight logging (weight optional; empty → `load_grams` null) — `app/client/workout/[dayId].tsx`
  - ✅ Zero-set finish guard (`confirm` before completing an empty session)
  - ✅ Rest timer (countdown after each set, skippable, haptic at zero)
  - ✅ Relabel "Send to coach" → "Save note" (the note already shows in the coach's feedback card)
  - ✅ Haptics wrapper `src/lib/haptics.ts` (expo-haptics) — wired to set-complete / finish / rest-done
  - ✅ Coach-less Home CTA (accept-invite primary, find-a-coach secondary) — `ClientHome.tsx`
  - ⏸ **Notify the coach on note submit** → moved to **Slice F**. Reason: it needs a server-side
    trigger (no client insert path, §8) *and* a new notification type rendered in the feed UI — far
    more coherent built alongside F's coach notes surface, and avoids a prod migration in the blocker slice.
  - ⏸ **Chat-tab coach-less empty-state CTA** → moved to **D2b** (when `messages.tsx` is i18n'd anyway,
    so we don't add throwaway English now).
- ✅ **B — Progress/media delete + body-metric safety** (code done; needs **function deploy**, see below)
  - ✅ `media-delete` **Edge Function** (NOT a migration/RLS policy) — `supabase/functions/media-delete/`.
    Why: the `media` table is service-role-write-only and the storage buckets have **no object policies**,
    so a client can't delete the object directly; deletion must go through a service-role function that
    verifies owner_id === caller, removes the bytes, then the row. All FKs to media(id) are ON DELETE SET
    NULL, so no constraint breaks. `deleteMedia()` added to `src/lib/media.ts`.
  - ✅ Owner-guarded delete in the photo viewer (`progress/view.tsx`, `own` flag from photos + inbody grids).
  - ✅ Coach `body-metric.tsx`: `confirmDestructive` on Discard; `DateField` (native picker + web text fallback).
  - ✅ **Deployed to prod** — `media-delete` is ACTIVE (verify_jwt on). No DB migration, so advisors unchanged.
    The native date picker + haptics need the next **dev-client rebuild**; everything else in A/B works on the
    current JS (run the branch via metro). On a stale native build the coach date tap should be avoided (web ok).
- 🔵 **C — App-wide quality basics** — foundation done
  - ✅ Toast system (`ui/Toast.tsx` + `ToastProvider` at root + `useToast()`), in-house on Reanimated.
  - ✅ Unsaved-changes guard hook (`src/lib/useUnsavedGuard.ts`, `usePreventRemove` + `confirm`).
  - ✅ Haptics wired into set-complete/finish/rest (A) + plans makeActive + template save.
  - ✅ Applied to already-i18n'd surfaces: plans `makeActive` toast; `public-profile-edit` dirty-tracking + guard + save toast.
  - ⬜ Remainder (error+retry, pull-to-refresh on remaining deep screens, save toasts on the **hardcoded** screens) → folded into **Slice D** per file, to avoid double-touching the 27 English-only screens.
- ✅ **Template-save fix** (user-reported, plan-management): a freshly cloned/blank template no longer auto-lands
  in "your plans". `new-plan` passes `fresh=1`; the editor shows **"Save to my plans"** and discards the clone on
  back-without-save (usePreventRemove). No data-model change. `coach/new-plan.tsx`, `coach/plan/[id].tsx`.
- 🔵 **D — Full bilingual retrofit + a11y**
  - ✅ **D1 auth/onboarding** — sign-in/up, forgot/reset, onboarding, accept-invite, become-coach, profile, profile-setup
    (new namespaces: auth, onboarding, acceptInvite, becomeCoach, profileSetup, profile; `label()` title-caser replaced
    with dictionary lookups via `labelFor`; a11y on links + option rows; profile save → toast).
  - ✅ **D2a** client daily-1 — workout logger, food/add (+ header date picker), food/preferences
    (new food + workout namespaces; `label()` removed from both food screens; a11y on toggles/skip).
  - ✅ **D2b** client daily-2 — 5 progress pillars + viewer + messages tab (progress namespace extended +
    new messages namespace; FIELD/COACH_OCR_MESSAGE de-hardcoded; **coach-less chat CTA → accept-invite** landed here).
  - ✅ **D3** coach/admin — exercise/food pickers, invite, admin/applications, AdminHome, **coach/client/[id].tsx** (589 lines),
    **coach/body-metric.tsx** (full InBody review screen incl. all medical-term labels).
    (new coach/admin/clientDetail/bodyMetric namespaces; `label()` removed from all 3 screens that used it; PROMPT_CHIPS → keys;
    `t`-shadow fixes in client detail; module-scope ExtrasCard/DateField/FoodRow got their own useTranslation).
  - ✅ **D4** nav titles — all ~35 `Stack.Screen` titles in `app/_layout.tsx` via a new `nav` namespace
    (`RootNavigator` got `useTranslation`; titles also feed the iOS back-button label).
  - ✅ **Slice D COMPLETE** — full-app sweep confirms the only `app/` screen without `useTranslation` is
    `(tabs)/index.tsx`, a pure role-home delegator with no strings. Every user-facing screen is bilingual (EN/AR + RTL).
- ✅ **E — Catalog expansion** — `0047` **APPLIED to prod 2026-06-27** (advisors clean; globals 49→111
  exercises, 30→105 foods; every food categorised). Live on the current app build — no app deploy needed.
  - ✅ **Taxonomy refinement (founder feedback)** — `0048`+`0049` APPLIED to prod 2026-06-27 (advisors
    clean). Retired the sparse `upper`/`lower` buckets (→ legs/push/pull) and added a dedicated **`arms`**
    category (biceps/triceps/forearm, pulled out of push/pull); shoulders stay in push, rear-delts in pull.
    Final: push 25 · pull 22 · legs 35 · arms 16 · core 15. TS `muscleGroupSchema` + en/ar muscle labels
    updated (parity 985/985). Edge AI fns read `muscle_group` as free-form string → no redeploy.
    Also fixed a latent RLS-harness PK collision (`0047` e1…0a/f1…0b clashed with seed customs → moved to ca…/cb…).
  - ✅ `0047_expand_catalogs.sql` — pure additive global seed (coach_id NULL), no schema/RLS change,
    idempotent (`on conflict (id) do nothing`). **+62 exercises** (push/pull/legs/upper/lower/core +
    Olympic; richer `primary_muscle`) and **+75 foods** incl. Egyptian staples (koshari, ful, taameya,
    aish baladi, molokhia, mahshi, tahini, basbousa, konafa…) with `category` + integer macros/100g.
  - ✅ Registered in `supabase/tests/rls/runner.ts`. No app change needed — `listExercises`/`listFoods`
    already read these columns and the SELECT policies expose `coach_id IS NULL` globals to everyone.
  - ✅ De-risked: rolled-back `begin…rollback` dry-run on prod schema = clean (enums/columns/constraints OK).
  - ⏸ Dropped the optional `is_bodyweight` column — nothing reads it yet (dead schema); trivial follow-up
    for Slice F's exercise picker if wanted.
  - ✅ Applied `0047` to prod 2026-06-27 (advisors clean).
- ✅ **F — Coach workflow**
  - ✅ **F1** Message button on coach client-detail → DM that client (`/chat/[id]`).
  - ✅ **F2** Assign-with-context: client-detail → templates in "assign mode" (tap a template = clone onto this client).
  - ✅ **F4** Split client-detail into Overview / Plans / Progress / Notes sub-tabs (Segmented header).
  - ✅ **F5** Coach-feedback notification: athlete workout note → `client_note` in-app notification to the coach.
    **Migration `0050` APPLIED to prod 2026-06-27** (advisors clean; trigger fn EXECUTE-revoked, no new 0029).
  - ✅ **F3** Surface AI plan-gen from new-plan → client-picker (`coach/ai-plan.tsx`) → existing generator (`?openAi=1`).
  - ⏸ **F6** plan-editor UI-kit refactor — **DEFERRED (founder call, 2026-06-27)**. The 1012-line editor is
    already on-brand via theme tokens; a full kit migration is high-risk/low-value on the core coach screen,
    and a partial pass would leave it half-migrated. Revisit as its own reviewed PR post device-test.
- ⬜ **G — Larger items** (G1 Ranks→Analytics merge + leaderboard in-page UX · G2 coach_requests funnel · G3 admin console · G4 nutrition barcode/serving sizes)
- ⬜ **H — First-run tour + guided goal wizard**

## Founder follow-ups (post-F, 2026-06-27)
- ✅ **Plan-editor brand fix** — "Publish to client" was success-green; now Signal-cyan + onyx text.
- ✅ **Chat gesture/keyboard fixes** — double-tap-to-react no longer drops the keyboard; swipe-to-reply
  accepts diagonal drags + works with the keyboard up (`keyboardShouldPersistTaps="handled"`).
- ✅ **Notes in chat + plan editor** — `0051` **APPLIED to prod** (advisors clean). An athlete workout note
  now mirrors into the client↔coach chat as a note card AND shows inline on the exercise in the plan editor.
  Kept the F4 Notes tab + F5 client_note notification (→ **double-notify per note**; dedupe is a ~3-line change).
  Realtime-arriving note cards show body only until refetch (embed not in the realtime payload).

## Prod migrations pending go-ahead
coach_requests (G2) · serving sizes (G4).
_(Done & applied to prod 2026-06-27: `0047` catalog · `0048`/`0049` arms recategorize · `0050` workout-note
notification · `0051` workout-note-in-chat. Slice B's media-delete shipped as an Edge Function, not a migration.)_

## Known limitations flagged for pilot
- Arabic UI but **English food/exercise names** in the catalog (DB `name_ar` is post-pilot).
- No offline/cache for poor gym signal (post-pilot).
