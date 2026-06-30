# Rule: Web build & responsive coach portal

Topic detail for the **web** target (Expo Router `output: static`, react-native-web) and the
responsive **coach desktop portal**. **This file wins over a prompt.** Hard-won from the
coach-web-portal build — each bullet is a bug we already shipped once; don't repeat it.

## Architecture — the coach desktop shell
- The portal is the SAME single codebase, not a second app (CLAUDE.md §1). On WIDE web for a
  **coach** it renders a left sidebar + top bar; everything else (native, phone-width web, client/
  admin) keeps the phone bottom-tab layout.
- It's a **root-level** wrapper: `src/components/coach/web/CoachWebChrome.tsx` wraps the WHOLE
  root `<Stack>` in `app/_layout.tsx`, so the sidebar persists across BOTH tab routes and pushed
  detail routes. A wrapper inside `(tabs)/_layout.tsx` would vanish on a detail push — don't.
- Gate everything on `useIsWideWeb()` (`src/lib/useBreakpoint.ts`, `Platform.OS==='web' && width>=1024`)
  **and** `role==='coach'`. When false, `CoachWebChrome` is a pure pass-through (`<>{children}</>`),
  so native/narrow/client/admin are byte-for-byte unchanged. `Screen` reads `ChromeContext`
  (`src/lib/chrome.ts`) to center+cap content to 1240 in-shell; do NOT add per-screen web hacks.
- Bottom tab bar is hidden in-shell via `tabBar={() => null}` (web+coach only) — keep every
  `<Tabs.Screen>` + `href:null` registration so the sidebar can still `router.navigate` to them.

## RN-Web gotchas (these silently break or no-op on web)
- **TextInput key events: RN-Web FILTERS `onKeyDown`/`onKeyPress` props** — they never reach the
  DOM, so Enter-to-submit wired that way does nothing. Attach a **real DOM `keydown` listener via
  the TextInput's web ref** in a `useEffect` (`const node = ref.current as unknown as HTMLElement;
  if (node?.addEventListener) node.addEventListener('keydown', …)`); native uses `onSubmitEditing`.
  ONE mechanism per platform (never both → double-submit). Enter submits, Shift+Enter = newline.
  See `src/components/ui/Input.tsx` + the `app/chat/[id].tsx` composer.
- **No `.web.tsx` variant files for desktop layouts.** Metro resolves `*.web.tsx` for PHONE web
  too (which must stay mobile). Select the desktop variant at **runtime** (`if (useIsWideWeb()/
  useChrome().active) return <XDesktop/>`), as normal modules under `src/components/coach/web/`.
- **No CSS `display:'grid'`** — RN's `ViewStyle` doesn't type it and it crashes off-web. Use
  computed flex columns (`src/components/ui/ResponsiveGrid.tsx` / the `RosterMatrix` `wide` pattern).
- **Disable navigation animations on web.** The native-stack `slide_from_right` (220ms) + the tabs
  `shift` read as "press → wait → it loads" lag in a desktop dashboard. Set
  `animation: Platform.OS==='web' ? 'none' : theme.motion.*` on BOTH the root `<Stack>` and `<Tabs>`
  (and `animationDuration: 0` on the Stack). Native keeps the transitions.
- **`Alert.alert` is a no-op on web** (and its multi-button form is a no-op even on… see ui.md).
  Use `useToast()` for errors and a `Modal` sheet for confirms/choices. Mic-permission / send
  failures in the web composer toast, never Alert.
- **Supabase Realtime: never re-subscribe a fixed-name channel.** `supabase.channel(name)` returns
  the cached channel; calling `.on()` on an already-subscribed channel throws
  *"cannot add postgres_changes callbacks after subscribe()"* (it crashed every route because the
  messages tab is eager-mounted). **Subscribe ONCE** (effect deps `[userId]`) with a **unique
  channel name** (`desktop-${Math.random()…}`), read changing values (the open conversation) from a
  **ref**, and `supabase.removeChannel` on cleanup. Don't key the subscribe effect on the selection.
- **react-native-svg gradients need a UNIQUE `id` per instance.** Multiple same-tier `RankCrest`
  gems on one page (leaderboard, roster) emit duplicate `<RadialGradient id="crest-apex">`; on web
  `fill="url(#crest-apex)"` fails to resolve against a duplicate → the gem renders **gray**. Use
  `useId()` (strip the `:`) in the id. Applies to any react-native-svg `url(#id)` reference.

## Rules of hooks — scan EVERY touched file, including the shell
- A desktop `if (wide) return <Desktop/>` (or `<Redirect/>`) early return must come **after ALL
  hooks**. This bit `app/_layout.tsx` (a `useIsWideWeb()` placed after `if (initializing) return
  <BootSplash/>`) and `app/(tabs)/clients.tsx` (an `if (active) return` before ~12 hooks) — both
  crash on resize ("rendered more/fewer hooks"). When auditing hook order, cover the **shell layout
  files** (`app/_layout.tsx`, `app/(tabs)/_layout.tsx`) and the desktop components, not just screens.

## Cross-route desktop variants need a redirect on resize
- When a screen's desktop version lives on a **different route** (mobile `app/chat/[id].tsx` →
  desktop 3-pane `/messages`), a breakpoint flip (resize / opening DevTools) strands the user on the
  wrong route. Add a guard: `if (useIsWideWeb() && role==='coach') return <Redirect href={{pathname:
  '/(tabs)/messages', params:{peer:otherId}}}/>` (after all hooks). SAME-route `if(wide)` variants
  (`coach/client/[id]`, etc.) adapt automatically and need no redirect.

## Honest data on web surfaces (no fabricated stats — CLAUDE.md discipline)
- The Brand-Identity mockups show decorative numbers with no real source. Compute REAL where cheap;
  otherwise OMIT or substitute the closest real field — never invent:
  - Client **FFMI tier** needs height_cm + sex (the coach board RPC lacks them) → show the client's
    **goal** instead; flip to tier only once the board exposes height/sex.
  - Client **"goals count"** has no source (single-goal model) → show **sessions**.
  - Leaderboard **"Move"** column needs rank-history snapshots we don't store → **omit** (a future
    migration), don't fake.
  - Template **Weeks/Clients/Adherence** ARE derivable client-side (listWeeks + getPlanEffectiveness
    by `source_plan_id` + getAdherenceOverview) → compute them; **Billing** is a static "Pilot" card.

## i18n + verification
- New web copy lives under `webnav.*` (sidebar/top-bar) and `webportal.*` (per-view); both locales,
  full parity — run the en/ar one-liner in `.claude/rules/i18n.md`. Keep `tsc --noEmit` green; a bad
  `t()` key path doesn't fail tsc, so parity + a visual check are the real gates.
- The portal effort is **DB-untouched** (pure client/web) — no migration, RLS, or edge-function
  change. The only DB work in the same era was migration 0082 (coach-request), already in prod.
