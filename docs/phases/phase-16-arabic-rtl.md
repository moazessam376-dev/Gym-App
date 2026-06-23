# Phase 16 — Full Arabic + RTL

> Make the app bilingual: **English ⇄ Egyptian-Arabic (عامية مصرية)** with a user-facing
> language switcher and full right-to-left layout. The i18n/RTL **framework** shipped in
> 14b (`src/i18n/`, `t()`, `setLanguage`→`needsReload`, `applyDirection`); this phase adds
> the **content** (`ar.json`), the **switcher UI**, the **RTL reload**, and migrates the
> remaining hardcoded English to `t()`.
>
> **Founder decisions (this session):** register = **Egyptian colloquial** (warm/local, whole
> app); **English stays available** via the switcher (bilingual, not Arabic-only); rollout =
> **slices** — Slice 1 = switcher + RTL + core screens, the rest follow.

Roadmap source: `~/.claude/plans/i-have-features-that-snuggly-tome.md` (Tier 2, Phase 16).

---

## Current state (verified)
- Framework live: `src/i18n/index.ts` (init, device-locale detect, persisted override via
  `src/lib/prefs.ts`, `setLanguage` returns `{ needsReload }` on the LTR↔RTL boundary,
  `applyDirection` gates `I18nManager.allowRTL/forceRTL`). `SUPPORTED_LANGUAGES = ['en']`,
  `RTL_LANGUAGES = ∅` — both ready to take `'ar'`.
- Only **3 files** use `t()` today (`app/(tabs)/_layout.tsx`, `account.tsx`, `analytics.tsx`);
  **~47** still have hardcoded English. **No switcher UI yet.**
- 14b finding: the shared UI primitives (`src/components/ui/`) have **zero** hardcoded
  `left`/`right` — they use `gap`/`flex`/symmetric padding, so they're direction-agnostic.
  RTL work is text alignment + a few screen cases + flipping directional chevrons.

## RTL reload mechanism
RN only fully applies an `I18nManager` direction change after a **bundle reload**. `expo-updates`
is not installed, but the `expo` package exports **`reloadAppAsync()`** (SDK 49+, works in Expo
Go + production, no new dependency). The switcher: `setLanguage(lng)` → if `needsReload` (always
true for en↔ar, since en=LTR and ar=RTL), show a short confirm ("App will restart to apply
Arabic"), then `reloadAppAsync()`. On web, `reloadAppAsync` also reloads. Persisted choice is read
on next boot by `loadSavedLanguage()`, and `applyDirection` re-applies before first paint.

---

## Slice 1 (this round)

1. **Enable Arabic in the framework** (`src/i18n/index.ts`): add `'ar'` to
   `SUPPORTED_LANGUAGES` and `RTL_LANGUAGES`, register `ar` resources (`ar.json`). Nothing else
   in the framework changes — it was built for exactly this.
2. **`src/i18n/locales/ar.json`** — Egyptian-colloquial translations of **every key currently in
   `en.json`** (common, tabs, account, language, analytics) so the already-migrated screens are
   fully bilingual immediately. Numbers/dates stay Latin-digit + UTC under the hood (Egyptian
   users read Latin digits fine; Arabic-Indic digits deferred).
3. **Language switcher UI** — a row in the Account screen (`account.language` string exists)
   opening a small chooser (English · العربية), current language checked. On change:
   `setLanguage` → confirm-restart → `reloadAppAsync()`. Uses the existing `Segmented`/list
   primitives. English ⇄ Arabic both reachable from here.
4. **Migrate core screens to `t()`** (highest-traffic): `ClientHome`, `CoachHome`, the client
   tabs `nutrition.tsx`, `progress.tsx`, `plans.tsx` (+ `index.tsx` host). Every new string added
   to **both** `en.json` and `ar.json`. Keep keys namespaced per screen (`home.*`, `nutrition.*`,
   `progress.*`, `plans.*`).
5. **RTL polish on the migrated screens** — audit for hardcoded `left/right`, flip directional
   icons (`chevron-forward` etc.) under RTL, confirm `row` layouts read correctly (they use `gap`,
   so most are fine). Use logical props where a fix is needed.

**Out of slice 1 (later slices):** coach plan editor + builder screens, pickers
(food/exercise), modals, auth screens, profile/questionnaire, body-metric/InBody screens, chat,
ranks. Plus Arabic-Indic digit formatting + date localization if the founder wants it.

---

## Translation conventions (Egyptian colloquial)
- Warm, second-person, everyday Egyptian (e.g. "Keep it up" → "كمّل كده", "Log" → "سجّل",
  "Nutrition" → "الأكل"). Avoid stiff MSA where a natural Egyptian word exists, but keep settings/
  destructive actions clear and unambiguous.
- Interpolation + plurals via i18next (`_one`/`_other`; Arabic has more plural categories —
  i18next handles `ar` CLDR plurals, so add `_zero/_one/_two/_few/_many/_other` only where a
  counted string needs them; most UI counts use `_other` + `_one`).
- Keep the founder in the loop: these are first-pass translations to **review/adjust** in-product.

## Security / discipline
- No schema, no migration, no Edge Function, no new dependency. The persisted *language choice* is
  a non-sensitive preference (already in `prefs.ts`, not SecureStore-for-secrets). RLS harness
  unaffected. `tsc` is the gate.

## Verify
- `tsc` green. Switch to Arabic in Account → confirm-restart → app reloads RTL, every migrated
  screen reads right-to-left with Egyptian copy; switch back to English → reloads LTR, identical
  to before. Device + web.

## Definition of done (slice 1)
- [ ] `'ar'` enabled in `SUPPORTED_LANGUAGES` + `RTL_LANGUAGES`; `ar.json` covers all existing keys.
- [ ] Language switcher in Account (English · العربية) with confirm-restart + `reloadAppAsync()`.
- [ ] Core screens (`ClientHome`, `CoachHome`, `nutrition`, `progress`, `plans`) fully `t()`-ized,
  strings in both `en.json` + `ar.json`; directional icons flip under RTL.
- [ ] `tsc` green; manual en⇄ar round-trip verified.

## Deferred (later slices)
- The remaining ~40 screens (editor, pickers, modals, auth, profile, chat, ranks, body-metrics).
- Arabic-Indic digits + Arabic date formatting (UTC stays under the hood).
- Making user-facing **AI output** returnable in Arabic (the coach AI prompts currently force
  English; revisit when the Claude launch model lands).
</content>
