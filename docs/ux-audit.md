# UX / IA Audit (pre-pilot)

> Living document. Walks every screen × role against a fixed checklist and records findings
> tagged **P0** (blocks pilot / breaks a core flow), **P1** (clear UX harm, fix before pilot),
> **P2** (polish, post-pilot ok). Each finding has a one-line fix.
>
> Status legend per screen: ✅ reviewed in code · 🚗 still needs a hands-on driving pass on a
> real build (states/motion can't be fully judged from source).

## Checklist (scored per screen)

1. **Placement** — is this feature where a user would look for it? (IA)
2. **Primary action** — is the main thing you'd do here obvious and one tap away?
3. **States** — empty / loading / error present, branded, not blank?
4. **Save/exit semantics** — is persistence explicit and predictable?
5. **Destructive actions** — confirm + recoverable where possible?
6. **Motion** — entry transition + first-load feedback?
7. **i18n/RTL** — strings localized (en+ar), layout mirrors?

---

## Cross-cutting findings (affect many screens)

| # | Finding | Pri | Fix | WS |
|---|---------|-----|-----|----|
| X1 | No screen-level entry transition; stack pushes appear abruptly. | P1 | Brand `animation` on root `Stack` + `Tabs` (~220ms, RTL-aware). | W3 |
| X2 | Fetch-on-open stack screens show a blank/partial frame on first open. | P1 | Shared `ScreenLoader` driven by primary query `isPending`; cache means no repeat on revisit. | W3 |
| X3 | "Tab-switch render flash" reported. CLAUDE.md flags it as a likely **dev-mode artifact**. | P2 | Verify on an EAS/release build before adding any machinery. | W3 |
| X4 | i18n is only partially rolled out (CLAUDE.md "Slice 3" still English: pickers, food add/prefs, chat, auth, profile/onboarding, body-metrics, AdminHome, some `src/lib` strings). | P1 | Finish Slice 3 with en/ar parity; don't ship new English strings. | W0→W1/W2 |
| X5 | Mutations are direct async calls, not `useMutation`; no toast/snackbar confirms a save. | P2 | Add lightweight success feedback where a write isn't otherwise visible. | W2 |

---

## CLIENT

### Home — `src/components/home/ClientHome.tsx` ✅
- **Good:** strong primary action (hero ring → Start/Continue workout), cached queries (no 0→value flash), league CTA with 4 contextual states, nutrition + coach cards.
- **F-C1 (P1, Placement):** Account is only reachable from the header avatar — discoverable but non-obvious. Acceptable, but pair with a clearer affordance. → W1.
- **F-C2 (P1, Placement):** League/leaderboards only reachable via the CTA card *if* `league` resolves; no persistent entry. Add a **trophy button in the header** next to the bell. → W1 (ranking surfacing).

### Plans (Your Training Plan) — `app/(tabs)/plans.tsx` ✅
- **F-C3 (P0, Destructive/Save):** no delete and no multi-plan switching; list → read-only detail only. → W2.
- **F-C4 (P1, States):** empty state present; loading shows nothing (`ListEmptyComponent` null while pending) — fine, but no per-row active indicator. Add an "Active" badge once multi-plan lands. → W2.

### Nutrition — `app/(tabs)/nutrition.tsx` 🚗
- **F-C5 (P1, Placement):** **Food preferences** lives in Account, not here. Move into the Nutrition tab. → W1.
- Needs driving pass for empty/loading/error + log-food save feedback (i18n Slice 3 pending).

### Progress — `app/(tabs)/progress.tsx` 🚗
- Sub-screens (weight/photos/inbody/body-comp) are fetch-on-open stacks → apply `ScreenLoader`. → W3.
- Needs driving pass; photo viewer transition is custom (transparent header).

### Messages — `app/(tabs)/messages.tsx` 🚗
- Needs driving pass; i18n Slice 3 (chat) pending. → W0/W1.

### Account — `app/(tabs)/account.tsx` ✅
- **F-C6 (P0, Placement):** junk drawer — identity + settings + community + role ops + lifecycle all in one. → W1 (de-junk: keep identity + role actions + Settings link + danger zone).
- **F-C7 (P1, Placement):** Community block (Public profile, Discover, Leaderboards) buried here. Move to Home/profile context. → W1.

---

## COACH

### Home (Performance Hub) — `src/components/home/CoachHome.tsx` ✅
- **Good:** twin KPI tiles deep-link to Clients/Invite; top-performers list is real data; no duplicate quick-action grid.
- **F-K1 (P2, Placement):** no header avatar→Account on coach Home (coach has an Account tab, so ok).

### Clients — `app/(tabs)/clients.tsx` 🚗
- **F-K2 (P1, Placement):** **Invite client** and **Plan templates** live in Account; promote to this tab's header (where a coach actually works). → W1.

### Ranks (own clients) — `app/(tabs)/leaderboard.tsx` 🚗
- Distinct from public leaderboards; ranks the coach's own clients by weekly sessions. Confirm naming doesn't collide with public boards in UI. 🚗

### Analytics — `app/(tabs)/analytics.tsx` 🚗
- **F-K3 (P2, Placement):** coach carries a heavy 7-tab bar. Audit whether Analytics folds into Home/Ranks. Decide from driving pass; don't pre-cut. → W1.

### Templates — `app/coach/templates.tsx` ✅
- **F-K4 (P0, Destructive):** no delete on templates; tap only edits. Wire `deletePlan()` + confirm. → W2.
- **F-K5 (P1, States):** rows don't show plan status (draft/published). Surface status badges. → W2.

### Plan editor — `app/coach/plan/[id].tsx` ✅ (924 lines)
- **F-K6 (P0, Save):** every edit auto-persists and a freshly generated/assigned plan inserts immediately → "open → back = saved outside." Add explicit Save/Discard for **draft** plans. → W2.
- **F-K7 (P1, Destructive):** delete-week/day exist but no delete-whole-plan. → W2.

### Assign to client — `app/coach/assign/[id].tsx` 🚗
- Deep-clones template → draft → opens editor. Ties into the Save/Discard semantics (F-K6). → W2.

### Client detail — `app/coach/client/[id].tsx` 🚗 (589 lines)
- **F-K8 (P0, Destructive):** assigned-plan list (~491–513) has no delete. → W2.
- Needs driving pass on the AI plan-gen modal flow + states.

---

## ADMIN

### Home — `src/components/home/AdminHome.tsx` 🚗
- Minimal console (Coach applications card). i18n Slice 3 (AdminHome) pending. → W0/W1.

### Applications / Reports — `app/admin/{applications,reports}.tsx` 🚗
- Moderation surfaces; need driving pass for empty/loading/error + destructive confirms.

---

## SHARED STACK SCREENS (all roles)

`profile`, `profile-setup`, `become-coach`, `accept-invite`, `notification-settings`,
`public-profile-edit`, `community-guidelines`, `notifications`, `discover/coaches`,
`leaderboards/index`, `athlete-profile/[id]`, `coach-profile/[id]`, pickers, `chat/[id]`,
`food/add`, `food/preferences`. 🚗

- **F-S1 (P1, Motion/States):** all are fetch-on-open → benefit from `ScreenLoader` + entry transition. → W3.
- **F-S2 (P1, i18n):** several are in the pending Slice 3 batch. → W0.
- **F-S3 (P1, Placement):** new **Settings** screen should absorb notification-settings + language + guidelines. → W1.

---

## Consolidated pre-pilot backlog

**P0 (blocks pilot)** → all in **W2** + **W1**:
- F-C3 / F-K4 / F-K7 / F-K8 — plan delete missing everywhere (W2).
- F-K6 — silent "saved outside" / no Save·Discard for drafts (W2).
- F-C3 — multi-plan switching (W2).
- F-C6 — Account junk drawer (W1).

**P1 (fix before pilot)**:
- F-C2 / F-C7 — surface ranking + move community out of Account (W1).
- F-K2 — promote coach Invite/Templates to Clients tab (W1).
- F-C5 — Food preferences → Nutrition tab (W1).
- F-S3 — Settings screen consolidation (W1).
- X1 / X2 / F-S1 — transitions + ScreenLoader (W3).
- X4 / F-S2 — finish i18n Slice 3 for any touched screens (rolling).

**P2 (post-pilot ok)**: X3 (verify flash on release), X5 (save toasts), F-K3 (coach tab consolidation), F-K5 (template status badges).

> 🚗 screens still need a hands-on driving pass on a real build to finalize state/motion findings;
> do that pass as each workstream touches the screen.
