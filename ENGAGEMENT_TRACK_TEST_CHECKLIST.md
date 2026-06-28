# Engagement Track — Test Checklist (for founder + GLM)

All 9 PRs of the "feels empty" engagement track are **code-complete on branch
`cc/sec-token-push-hardening`** (migrations 0071–0081). Each migration was dry-run-validated
against prod (`begin … rollback`); `tsc` + en/ar parity are green. **Nothing is committed or
applied yet** — the steps below assume you've applied the deploy prerequisites.

**Logins:** shared password `Pilot-Raptor-2025!` · coaches `coach.01..20@pilot.test` · athletes
`athlete.001..220@pilot.test` · admin `admin@pilot.test`.

---

## 0. Deploy prerequisites (do/authorize first — in this order)

> These are outward-facing; they need your explicit go-ahead. Until done, the features below
> won't show real data.

1. **Apply migrations 0071–0081** to prod (Claude via MCP, on your go-ahead). 0073 runs a
   one-time **backfill** → existing seeded users immediately get trophies (~1,500 minted).
2. **Re-apply `supabase/storage/buckets.sql`** (adds `audio/webm` + `audio/ogg` for web voice).
3. **Redeploy edge functions:** `media-finalize` + `media-create-upload` (new `transformation`
   media kind + webm/ogg), and `push-send` (H-2 fail-closed).
   - ⚠️ **`push-send` will return 503 until** Vault `push_shared_secret` **and** the function env
     `PUSH_SHARED_SECRET` are both set to the same value. Set them before/with this redeploy, or
     push delivery stops. (Push isn't live yet, so this is safe to sequence.)
4. **Rebuild the dev client** (EAS) before iOS testing of the **share button** (E3) and **voice
   notes** (E7) — they use native modules (`react-native-view-shot`, `expo-audio`). Expo Go also
   bundles these, so Expo Go on iOS works without a rebuild; an old standalone build does not.
5. After applying: run `get_advisors(security)` and confirm no new findings (the new SECURITY
   DEFINER RPCs are the accepted advisor-0029 set; no new tables without RLS).

---

## 1. PR-SEC — security (no visible UI; verify behavior)
- [ ] **H-3 device-token hijack:** can't be exercised from the UI directly. Confirm push still
      registers normally (sign in on a device → notifications still arrive after push is live).
      The RLS harness test `re-registering a token owned by another user does NOT reassign it (H-3)`
      covers it in CI.
- [ ] **H-2 push auth:** after setting the shared secret, a real notification (e.g. a coach sends
      a chat message) still delivers a push. If `PUSH_SHARED_SECRET` is unset → push 503s (expected).

## 2. PR-E1 — achievements / trophies
- [ ] Log in as **athlete.001** → open your own public profile (Account → Public profile → "View
      my public profile", or Discover). A **Trophies** grid shows (first workout, PRs, InBody, tier,
      etc.) from the backfill.
- [ ] Account → **Public profile** editor: the self-achievements list is capped at **3** (the
      "Add" disappears at 3; a `n/3` counter shows). Existing >3 were trimmed to 3 by the migration.
- [ ] A **public** athlete's trophies are visible when you open their profile from the leaderboard;
      body-derived trophies (tier / body-fat / lean-mass / InBody / goal) only appear if that athlete
      turned on **"Share my transformation"** (see E2).

## 3. PR-E2 — athlete profile enrichment
- [ ] As **athlete.001**, in Public-profile editor turn **Public** on, then **"Share my
      transformation"** on. Save.
- [ ] Open your public athlete profile. Verify: header tier chip (e.g. Diamond), **activity strip**
      (streak / last-30-days / training days), **goal-progress bar** (current vs target), a
      **transformation chart** (weight line) + body-fat / lean-mass delta chips, **trophy grid**,
      **PR gallery** (top lifts), and a **"Training with <coach>"** chip (if the coach is public).
- [ ] Open a public athlete who has NOT enabled "Share my transformation" → identity + activity +
      PRs + trophies show, but **no** weight/transformation/FFMI block (consent gate works).

## 4. PR-E4 — leaderboard reframe + coach self-rank
- [ ] Leaderboards → **Coaches** board: each coach shows a **median goal-progress** number (cyan,
      e.g. "+1.5") with "X of Y improved" underneath — the old green "100%" vanity number is gone.
- [ ] As a **coach** (coach.01) viewing the Coaches board: a pinned **"You · #N of M"** card shows
      your rank + median (or a "go public + 3 clients" nudge if not ranked).
- [ ] Athletes board: each row now shows **@handle** under the name.

## 5. PR-E3 — coach profile + branded transformations
- [ ] As **athlete.002**, enable **Public** + **"Let my coach feature me"**. Save.
- [ ] As that athlete's **coach**, Account → Public profile → **"Manage transformations"** → pick
      the consenting client, upload a **before** + **after** photo, add a caption, **Save**.
- [ ] Open the **coach's public profile**: an **Accepting clients** badge, an **outcome strip**
      (active clients + median progress), a **Transformations** showcase of **Raptor-branded
      before/after cards** (photos + body-fat/lean-mass deltas + tier before→after + caption), and
      (when set) a **Coaching philosophy** section.
- [ ] **(iOS, rebuilt client)** tap **Share** on a transformation card → native share sheet opens
      with the rendered card image. _(Web: no share button — screenshot manually; the card is still
      Raptor-branded so it's recognizable.)_
- [ ] Revoke the client's "Let my coach feature me" → the card disappears from the public showcase
      **and** its photos stop being publicly readable (consent-tied media RLS).

## 6. PR-E6 — chat note context
- [ ] As an athlete, add a **workout note** on an exercise during a session. As the **coach**, open
      the chat: the note card header reads **"<Exercise> · <Day> · <Date>"** — and it's there
      **immediately** (realtime), not just after a refresh.

## 7. PR-E5 — Performance tab (coach)
- [ ] As **coach.01**, open **Performance**: a **Roster activity** card with two **sparklines**
      (sessions/week + active clients/week) and **week-over-week** delta chips; a **Roster health**
      **matrix** (clients × adherence% / goal / sessions / last-active, color-coded, horizontally
      scrollable). Tap a matrix row → opens that client.

## 8. PR-E7 — voice notes (device-gated)
- [ ] **(iOS)** Record + send a voice note, then play it back → it plays through the **speaker**
      (not the earpiece). _(This is the E7 fix.)_
- [ ] **(Web, MacBook)** Record + send a voice note → browser mic prompt → records (webm) → sends +
      plays back. _(New web path; needs the bucket/edge redeploy from step 0.)_
- [ ] NOTE: the recording bar / playback bubble are brand-colored + functional, but the **exact
      HTML-reference rebrand was not applied** (that reference wasn't available in this build) — send
      it and it'll be matched in a fast follow.

## 9. PR-E8 — workout-log spacing (device-gated)
- [ ] **(iOS, small + large screen)** Open a workout day → scroll to the last set: the bottom inset
      now **clears the Finish bar exactly** (no big empty gap on short screens, no overlap on tall).

---

## Cross-cutting
- [ ] Switch app language **EN ⇄ AR** and re-check the new screens (all strings localized; parity
      verified). RTL layout flips.
- [ ] No console errors opening any rewritten screen with the seeded data.

## Known deferred (by design — not bugs)
- Coach **philosophy / accepting-clients / featured-plan** *editing UI* isn't built yet — the fields
  render with defaults (Accepting badge on; philosophy hidden until set). Values are wired end-to-end.
- **Sample-plan teaser** on the coach profile (needs the template title + a read-only plan route).
- **Voice-note exact HTML rebrand** (see E7 note).
- The Performance **adherence/median tiles** still show current snapshots (not sparklined) — only the
  new Roster-activity card is sparklined (honest weekly data); per-tile trends were out of scope.
