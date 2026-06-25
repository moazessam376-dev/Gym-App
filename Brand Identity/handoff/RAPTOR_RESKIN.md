# Raptor reskin — task brief for Claude Code

Goal: migrate the app from the current **"Midnight Blue / Neon Glassy"** look to the
**Raptor** identity — flat near-black (onyx) canvas, one electric **Signal cyan**
accent (`#3FD9C0`), **Geist** headlines, **JetBrains Mono** for every number, and a
calm, data-first voice. This is mostly a **theme-token swap** plus a copy sweep; the
8-tier ranking system is a **separate phase** (do not build it here).

> Follow the repo constitution in `CLAUDE.md` as always. This change touches only
> presentation (theme, fonts, copy) — no schema, RLS, auth, or money code. No secrets.

---

## Step 1 — Swap the three theme files (highest leverage)

Replace these files with the versions in this handoff folder:

- `src/theme/colors.ts`  ← `handoff/theme/colors.ts`
- `src/theme/typography.ts` ← `handoff/theme/typography.ts`
- `src/theme/effects.ts` ← `handoff/theme/effects.ts`

Every screen reads `@/theme`, so this reskins the whole app at once: navy→onyx,
electric-blue→cyan, glassy/glow→flat, Space Grotesk→Geist.

Two things the new files add that the app must wire up:

1. **`theme.colors` is unchanged in shape** — every key the app already uses is
   preserved (value-only swap). `colors.ts` also now exports **`tier`** (the 8-tier
   ramp) and a `Tier` type — re-export them from `src/theme/index.ts` alongside the
   existing exports.
2. **`textVariants` adds a `mono` variant** and the `TextVariant` union now includes
   `'mono'`. The `Text` component already maps `variant` → `textVariants[variant]`,
   so no change is needed there beyond TypeScript picking up the new union member.

After swapping, update `src/theme/index.ts` to also export `tier`:
```ts
export { darkColors, palette, tier, gradientFor, avatarGradients } from './colors';
export type { AppColors, Tier } from './colors';
```

## Step 2 — Load the new fonts

Install the packages (both confirmed on npm; `npx expo install` keeps versions aligned):
```
npx expo install @expo-google-fonts/geist @expo-google-fonts/jetbrains-mono
```
Inter is already installed and stays. In **`app/_layout.tsx`**, find the `useFonts`
map and:
- remove the `SpaceGrotesk_*` imports/entries,
- add `Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold, Geist_900Black`
  from `@expo-google-fonts/geist`,
- add `JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold`
  from `@expo-google-fonts/jetbrains-mono`,
- keep the `Inter_*` entries.

The font-family **strings** in `typography.ts` (e.g. `'Geist_700Bold'`) must exactly
match the keys passed to `useFonts`. The mono variant maps numbers to JetBrains Mono.

## Step 3 — Numbers → mono, kill the cringe

- **Numbers:** the `display` variant is now mono, so the big hero numbers (workout %,
  kcal left, streak, workouts done) become mono automatically. For inline stats/ranks
  rendered with `bodyStrong`/`caption`, switch the numeric ones to `variant="mono"`.
- **Voice:** sweep `src/i18n/locales/en.json` and `ar.json` and remove hype + emoji.
  Examples to fix: `home.workoutCrushed` ("Workout crushed!" → e.g. "Workout complete"),
  the 🔥 in the streak chips (Home + Nutrition top bars), any "Beast mode"/"Crushing it"
  style strings. Rule: **state the number, not an adjective.** Keep Egyptian-Arabic
  parity for every key you touch.

## Step 4 — Ranking system (SEPARATE PHASE — do not start here)

Today's `leaderboard` ranks a coach's clients by weekly sessions. The Raptor brand
promises a global **8-tier Bronze→Apex** system (body-comp + adherence + goals,
divisions, 12-week seasons, regional ranking). That's real feature work — data model,
tier computation, InBody verification — and should be scoped as its own phase against
the design system, not folded into the reskin. The `tier` palette + `Tier` type added
in Step 1 are the only ranking pieces that belong in this pass.

---

## Acceptance checklist
- [ ] App background is flat onyx `#0A0B0F`; no navy, no screen gradient glow.
- [ ] Primary buttons are Signal cyan with **dark** (`onPrimary`) text — not white.
- [ ] All headings render in Geist; all numbers render in JetBrains Mono.
- [ ] GlassCard renders as a flat slate card (no translucent sheen).
- [ ] No 🔥 / hype copy remains in `en.json` or `ar.json` (both locales).
- [ ] `tier` + `Tier` exported from `@/theme`; nothing hardcodes a tier hex.
- [ ] `npm audit` clean, RLS suite still green (unchanged by this work).

## Reference
Visual target = the Raptor design-system + before/after redesign docs. Token values
of record live in `handoff/theme/*.ts` (this folder) — treat those as the source of truth.
