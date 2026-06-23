# Phase 14 — Foundations pass (cache layer · i18n framework · AI cost · auth completeness)

> Four small, independent foundations that unblock and de-risk everything after the
> MVP. Three are "cheap now, brutal to retrofit" (a real data-fetching layer, the i18n
> framework, AI cost accounting); the fourth (auth/account completeness) is table-stakes
> for the controlled billing pilot and a PDPL obligation. **Each sub-phase ships as its
> own PR** so the cross-tenant RLS harness, `tsc`, and gitleaks stay green per slice.
> The anchor (Phase 15 Coach KPI Analytics) is built **on top of 14a + 14b**, so those
> two land first.

Roadmap source: `~/.claude/plans/i-have-features-that-snuggly-tome.md` (Tier 0). Founder
decisions locked: anchor = coach analytics; gyms deferred; billing during a pilot; Arabic
soon (framework now → full `ar` in Phase 16).

---

## 14a — Data-fetching + cache layer (TanStack Query) — *fixes the streak-flash bug*

**Problem.** There is no fetching/cache layer. Screens fetch with `useFocusEffect` +
`useState`, initial state zeroed. `src/components/home/ClientHome.tsx` defaults
`streak` to `0` and re-derives all state on each mount, so the chip paints **0** until
the `current_streak` RPC resolves, then jumps to the real value. Every "flash then fill"
screen has the same root cause. The only cache today is a 26-line in-memory `Map`
(`src/lib/screen-cache.ts`) used by 2 of ~30 screens.

**Build.**
- Add `@tanstack/react-query` (v5; supports React 19 / RN 0.81). Confirm on npm before install (§10).
- `src/lib/query.ts` — a shared `QueryClient` with RN-appropriate defaults: `staleTime`
  ~30s, `gcTime` ~1h, `retry: 1`, `refetchOnReconnect: true`. **No `refetchOnWindowFocus`**
  (no DOM window on native). Wire an `AppState` focus manager + `onlineManager` once, app-wide.
- **No disk persistence.** Query data includes sensitive health data (weights, body comp,
  names) — persisting the cache to AsyncStorage would write that to plain storage, violating
  §7/§5 intent. The cache is in-memory only; the cross-mount win comes from the QueryClient
  living above the navigator (`app/_layout.tsx`), not from disk.
- `src/lib/queries/` — thin `useQuery` hooks wrapping the **existing** lib fns (no new data
  code): e.g. `useStreak`, `useMyName`, `useMyCoach`, `useDailyNutrition`, `useTargets`,
  `useActiveTrainingDay`, plus coach `useMyClients`, `useMyInvitations`, `useBodyMetricsBoard`.
  Query keys are user-scoped (`['streak', userId]`) so a logout/login can't bleed data.
- Wrap the tree in `QueryClientProvider` inside `RootLayout` (`app/_layout.tsx`), above
  `AuthProvider` so the client survives navigation; `queryClient.clear()` on sign-out.
- **"Load buffer on app open"** (founder ask — YouTube-style logo hold): a branded
  `BootSplash` (`src/components/BootSplash.tsx`) overlays the app while `prefetchHome` **awaits**
  the whole role's queries, so the user enters a fully-populated app instead of watching values
  fill in. The navigator mounts underneath (routing + queries run, cache warms); the splash
  fades out (Reanimated `FadeOut`) once the prefetch settles. A **6s timeout fail-opens** so a
  slow/hung query can never trap the user on the splash. Runs once per signed-in user (a
  different sign-in re-boots). After this, `useRefreshOnFocus` + (future) realtime keep data live.

**Migrate (this PR):** **all 9 primary tab screens** — `ClientHome` + `CoachHome` plus the
client tabs (Plans, Nutrition, Progress) and coach/shared tabs (Clients, Ranks, Chat, Account).
Each drops its `useFocusEffect`/`useState` fetching and renders from `useQuery` last-known
values, with `useRefreshOnFocus` for a silent background refresh. Query keys are shared where
data is (`['my-clients']` is read by Home + Clients + Chat; `['streak']` by Home + Progress;
`['my-name']` by every header), so warming once makes many screens instant. `prefetchHome`
warms **every tab for the role** on app open — that's the "load buffer" that removes the
first-visit flash the founder reported (Clients loading in, the avatar resolving "C"→"CM").
Keep `screen-cache.ts` for now (the 2 detail screens still using it — `profile.tsx`,
`coach/client/[id].tsx` — migrate in a follow-up, then delete it).

**Eager tab mounting (the missing half of the fix).** Prefetching warms the *data*, but
expo-router tabs are **lazy** — a non-Home tab isn't constructed until first tapped, so it
(and its `FlatList`) builds *in front of you* after the splash is gone, even with warm data.
Fix: in `app/(tabs)/_layout.tsx`, set `lazy: false` on the tabs **visible to the current
role** (`eager(visible) = !visible`), so every tab the user can see is mounted + populated
**under** the boot splash. Hidden cross-role tabs stay lazy (default) so they never mount —
which also avoids a cross-role screen (e.g. the client-only `nutrition`, which renders a
`<Redirect>`) firing during a coach's boot. Net: after the splash drops, tab switches show
already-rendered, already-populated screens.

**Verify.** `tsc` green; manual: cold-open Home shows no `0→3` streak flash; switch tabs
back-and-forth → values stay put (no flash); airplane-mode shows cached values, not blanks.

> **Known dev-mode artifact (tracked in `docs/pre-launch-checklist.md`).** In Expo Go dev
> mode a brief tab-switch render flash remains even with prefetch + eager mount, because the
> data/architecture fix can't remove the react-native-screens render-on-focus cost, which dev
> mode (non-minified JS, dev React, no Hermes) amplifies. It is expected to be imperceptible on
> a release build. **Must be confirmed on a real release build before launch**; quick check:
> `npx expo start --no-dev --minify`. Next lever if it persists in production: `freezeOnBlur:
> false` on the visible tabs.

---

## 14b — i18n / RTL framework (no Arabic content yet)

**Build.**
- Add `expo-localization` + `i18next` + `react-i18next` (all confirmed on npm before install, §10).
- `src/i18n/` — init, device-locale detection, an in-app language override (persist the *choice*
  only — a preference, not user data — in SecureStore/AsyncStorage), and `en.json` resources.
- RTL: gate `I18nManager.allowRTL`/`forceRTL` behind the selected locale; audit the shared UI
  primitives (`src/components/ui/`) for hard-coded `left`/`right` → logical `start`/`end`.
- Externalize **new** strings (Phase 15+) via `t('...')` so the analytics screens ship
  translation-ready. Existing screens are migrated opportunistically; the bulk `ar` translation +
  RTL polish + QA is **Phase 16** (this phase is the framework, not the content).

**Built:** `src/i18n/index.ts` (init: device-locale detect via `getLocales()`, `en.json`
resources, `loadSavedLanguage`/`setLanguage` persisted override via `src/lib/prefs.ts`, RTL
helpers `isRTLLanguage`/`applyDirection` + an empty `RTL_LANGUAGES` set wired for `'ar'`),
`src/i18n/locales/en.json`, init imported in `app/_layout.tsx` + `loadSavedLanguage()` on
start. Proven end-to-end by migrating the **bottom-tab titles** and the **Account screen** to
`t('…')` via `useTranslation`. **RTL scope finding:** the shared UI primitives (`src/components/ui/`)
have **zero** hardcoded `left`/`right`/`marginLeft`… — they already use `gap`/`flex`/symmetric
padding, so they're direction-agnostic and Phase 16's RTL work is light (text alignment + a few
screen cases + flipping chevrons).

**Verify.** `tsc` green; app renders identically in `en`. Adding Arabic in Phase 16 = drop in
`ar.json`, add `'ar'` to `SUPPORTED_LANGUAGES` + `RTL_LANGUAGES`, add the switcher UI
(infrastructure already exists via `setLanguage`, which already returns `needsReload` for the
LTR↔RTL boundary). No `ar.json` and no switcher UI yet, by design.

---

## 14c — AI cost accounting

**Problem.** `ai_usage_events` (0027/0029) counts *attempts* only — no tokens, no dollars, no
model. Margins (Phase 23) are not computable.

**Build.**
- Migration `00NN_ai_usage_cost.sql`: add nullable `model text`, `tokens_in int`,
  `tokens_out int`, `cost_micros int` (integer **micro-USD** — same integer-money discipline as
  `amount_minor`/`weight_grams`, §6). Keep append-only + service-role-write-only RLS unchanged
  (owner/admin read only). Ships with its RLS intact in the same migration (§2).
- `_shared/vision.ts`: surface `{ model, tokensIn, tokensOut }` from each provider response
  (Groq + Anthropic both return usage). Add a small price table (micro-USD per token, per model)
  and compute `cost_micros` server-side.
- `_shared/rate-limit.ts` `recordUsage(...)`: accept + persist the new fields. **All callers
  keep recording before the model call (fail-closed, §9)**; backfill the usage numbers on the
  inserted row after the response returns (an UPDATE by the service role), or insert post-call —
  decide so a crash still consumes the slot but a clean failure refunds it (existing contract).
- Pilot on Groq = $0, but the columns capture real token counts now so the Claude-launch flip
  (`VISION_PROVIDER=anthropic`) immediately yields real dollar costs with no further work.

**Built:** migration `0030_ai_usage_cost.sql` (adds `model`/`tokens_in`/`tokens_out`/
`cost_micros` + a non-negative CHECK; RLS unchanged — 0027's owner/admin SELECT covers the
new columns, still no client write; the cost UPDATE is a service-role backfill like the
existing `refundUsage` DELETE), registered in `runner.ts`. `_shared/ai-pricing.ts` (list
prices USD-per-Mtok → integer micro-USD `costMicros`). `_shared/vision.ts` both providers
expose `lastUsage()` (Groq `prompt/completion_tokens`, Anthropic `input/output_tokens`).
`_shared/rate-limit.ts` `recordCost()` — **fail-safe** (swallows its own errors so cost
accounting can never break a successful AI call). All **7 AI functions** capture the usage row
id and call `recordCost(svc, usageId, provider.lastUsage())` on the success path (after the
model call, before the schema parse).

**Deploy ordering:** apply `0030` **before** redeploying the functions. (Not strictly
required — `recordCost` is fail-safe — but until 0030 lands the UPDATE no-ops with a logged
warning and no cost is recorded.) Deploy reuses the existing MCP flow (re-supplies all
`_shared/*` files per the Phase 13 note).

**Known limitation:** a clean model/parse failure refunds the slot via `refundUsage` (DELETE),
so its cost isn't recorded — a minor undercount (rare; $0 on the free pilot).

**Verify.** `tsc` (app) green; the Deno functions are outside tsc and Deno isn't installed
locally, so they're validated at deploy + the **CI RLS harness** applies 0030 + runs the
cross-tenant gate (it can't run on macOS — Debian-only pg tooling). After deploy: trigger one
of each AI function on a Supabase branch → rows carry `model` + token counts + a sane
`cost_micros`.

---

## 14d — Account & auth completeness (table-stakes + PDPL)

**Built now (self-contained + verifiable-by-logic):**
- **Forgot password** — `app/(auth)/forgot-password.tsx` (`resetPasswordForEmail`, redirect via
  `expo-linking` `createURL('/reset-password')`; always shows success → no account enumeration) +
  `app/(auth)/reset-password.tsx` (set-new-password via `updateUser`, then sign out) + a "Forgot
  password?" link on sign-in. Recovery routing in `auth-context.tsx` (`recovering` flag set on the
  `PASSWORD_RECOVERY` event) + the root guard forces the reset screen over normal "signed-in → app".
- **Account delete (PDPL right-to-erasure)** — Edge Function `account-delete` (service role): removes
  the caller's private storage objects (rows cascade with the profile, **files don't** — §7), then
  `auth.admin.deleteUser(caller.id)` cascades every profile-owned row. A coach's clients are NOT
  deleted (`profiles.coach_id` is `on delete set null` → unassigned). `src/lib/account.ts`
  `deleteAccount()` + a **double-confirm** danger-zone row on the Account screen. Generic errors (§4).
  **Forward-looking (Phase 23):** `transactions` must FK `on delete set null` + this fn must anonymize
  payer/payee — financial rows are never hard-deleted (§6). No such table yet → nothing to anonymize.

**Deferred to a "launch auth" follow-up (need external config + device testing — can't be verified
here):**
- **OAuth (Google + Apple)** — needs Google Cloud + Apple Developer credentials and Supabase provider
  config, plus `expo-web-browser`/native handling + device testing. Apple sign-in is App-Store-required
  once any third-party login exists.
- **Phone linking** — needs a paid SMS provider (Twilio) configured in Supabase; not a pilot blocker.
- **Deactivate** — a *correct* version needs server-enforced account-state + a reactivation gate
  (more than a flag); pairs naturally with the OAuth work. (A flag-only version would be misleading.)
- **Native password-reset completion** — the email link → app deep link → token → `setSession` path
  needs the Supabase redirect-URL allowlist (`gymapp://reset-password`, the web origin) + a deep-link
  handler + device testing. The **request email** + the **web completion** + recovery routing are done.

**Verify.** `tsc` (app) green. Web: request reset → email → link → set new password → sign in. Delete:
danger-zone double-confirm → `account-delete` → storage emptied + auth user gone + cascades + signed
out. The Edge Function is Deno (outside tsc, Deno not installed locally) → validated at deploy; no
migration in 14d → RLS harness unaffected (CI still runs it).

---

## Definition of done (foundations.md §8)
- [x] 14a: `QueryClientProvider` above the navigator; **all 9 tab screens** render from cache
  (no streak flash, no first-visit flash — every tab prefetched on app open); no disk
  persistence of sensitive data; `tsc` green.
- [x] 14b: i18n initialized (expo-localization + i18next + react-i18next), `en.json` in place,
  device-locale detect + persisted override + RTL helpers wired; proven on tab titles + Account.
  New strings via `t()`. Bulk translation + RTL QA = Phase 16.
- [x] 14c: migration `0030` adds model/tokens/cost (integer micro-USD) with RLS intact
  in-migration (service-role backfill, no client write); all 7 AI functions record real usage
  via fail-safe `recordCost`; registered in `runner.ts` (CI harness validates apply + gate).
- [x] 14d (core): forgot-password (request + web completion + recovery routing) + account delete
  (`account-delete` Edge Function, storage cleanup + cascade) with double-confirm danger zone;
  generic errors. **Deferred (launch-auth follow-up):** OAuth (Google/Apple), phone, deactivate,
  native-reset deep-link — all need external config + device testing (see `docs/pre-launch-checklist.md`).
- [ ] Each sub-phase is its own PR; gitleaks + `npm audit` + RLS suite green on each.

## Deferred
- Full Arabic translation + RTL QA across all screens → **Phase 16**.
- Migrating the remaining ~28 screens to `useQuery` and deleting `screen-cache.ts` (follow-ups
  after the home dashboards prove the pattern).
- Persisted/offline query cache — intentionally **not** built (sensitive health data on disk).
