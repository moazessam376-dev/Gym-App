# Rule: UI, theme & native modules

Topic detail for the Raptor design system + RN/Expo client. **This file wins over a prompt.**

## Icons — curated map only
`<Icon name="…">` accepts **only** names registered in `src/components/ui/Icon.tsx` (a
hand-mapped lucide set), not arbitrary Ionicons/lucide names. Wrong guesses fail with
`tsc` **TS2820** ("did you mean…"). Check the map first. Hard-won substitutions:
`clock` (not `timer-outline`), `mail` (not `mail-open-outline`), `person-add`, `trash`.

## Brand colours — a primary action is cyan-on-onyx
- A **primary / commit action** (Save, Generate, the main CTA) uses `theme.colors.primary`
  (Signal cyan) as the fill with **`theme.colors.onPrimary` text — which is onyx (DARK),
  NOT white.** Reusing the green `success`/"publish" style for a Save button is wrong (it
  reads as a different semantic and is off-brand — this exact slip shipped on "Save to my
  plans" before it was corrected).
- Tones: `success` = positive/published, `warning` = pending/draft, `danger` = destructive,
  `secondary` = cobalt. Don't repurpose a semantic colour for emphasis.

## Native modules need a dev-client rebuild
`expo-haptics`, `@react-native-community/datetimepicker`, and `expo-camera` are **native
modules**: on a **stale dev build** they no-op or crash until the dev client is rebuilt.
- Gate a native-only widget behind `Platform.OS` with a **web/text fallback** (the
  body-metric / food-add date pickers keep a typed field on web).
- Make haptics fire-and-forget and never throw (`src/lib/haptics.ts` already no-ops on web).
- These **do** work in **Expo Go** (it bundles them), so iOS testing needs no rebuild —
  only an old standalone/dev-client binary that predates the dep does.

## Save semantics — don't auto-persist on open
A row created just to open an editor (e.g. cloning a template) **must not** silently land
in the user's list if they back out. Pattern: treat it as **uncommitted** until an explicit
"Save" tap, and guard back-navigation with `usePreventRemove` to **discard-on-leave**
(see `coach/plan/[id].tsx` `fresh=1`). For edit forms, mark dirty on change and warn on
unsaved exit.

## Reusable client infra (prefer over rebuilding)
- `src/lib/confirm.ts` — `confirm` / `confirmDestructive` (cross-platform; `Alert.alert`'s
  multi-button form is a no-op on web, so always use these for confirms).
- **Shipped on PR #42 (pre-pilot refactor — see `docs/collab/BOARD.md`); reuse once merged:**
  `useToast()` (`src/components/ui/Toast.tsx`), `haptics` (`src/lib/haptics.ts`),
  `useUnsavedGuard` (`src/lib/useUnsavedGuard.ts`). Don't re-implement toasts/guards.
