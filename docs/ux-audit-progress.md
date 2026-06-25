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
  - ⚠️ **Deploy gate:** needs `deploy_edge_function media-delete` to prod (your go-ahead). The native date
    picker needs the next **dev-client rebuild**; web + media-delete work on the current build after deploy.
- ⬜ **C — App-wide quality basics** (toast, haptics breadth, error+retry, pull-to-refresh, unsaved guards)
- ⬜ **D — Full bilingual retrofit + a11y** (D1 auth/onboarding · D2a client daily-1 · D2b client daily-2 · D3 coach/admin · D4 nav titles)
- ⬜ **E — Catalog expansion** (migration 0048, needs prod go-ahead)
- ⬜ **F — Coach workflow** (Message button, assign-with-context, AI plan-gen entry points, client-detail sub-tabs, plan-editor UI-kit; + the deferred coach-feedback notification)
- ⬜ **G — Larger items** (G1 Ranks→Analytics merge + leaderboard in-page UX · G2 coach_requests funnel · G3 admin console · G4 nutrition barcode/serving sizes)
- ⬜ **H — First-run tour + guided goal wizard**

## Prod migrations pending go-ahead
0047 (media delete) · 0048 (catalog) · coach-feedback-notify trigger (Slice F) · coach_requests (G2) · serving sizes (G4).

## Known limitations flagged for pilot
- Arabic UI but **English food/exercise names** in the catalog (DB `name_ar` is post-pilot).
- No offline/cache for poor gym signal (post-pilot).
