# Pre-launch checklist (verify on a REAL release build before publishing)

> Things that look fine (or look broken) in Expo Go dev mode but **must be confirmed on a
> production/release build** before the app is published. Dev mode (non-minified JS, dev-mode
> React, no Hermes optimization, Metro over the network) is much slower than a release build,
> so performance artifacts seen in Expo Go are often absent in production — and a few real
> things only exist in a release build. Re-check every item here on an **EAS preview/release
> build** (or `npx expo start --no-dev --minify` for a quick production-JS approximation).

## Performance / UX
- [ ] **Tab-switch render flash (Phase 14a).** In Expo Go dev mode, switching tabs shows a
  brief "screen taking its place" render even though the data is prefetched and the tabs are
  eager-mounted (`lazy: false`) under the boot splash. This is the react-native-screens
  render-on-focus cost, heavily amplified by dev mode. **Verify it is imperceptible on a
  release build.** If it still shows on a true release build, the next lever is
  `freezeOnBlur: false` on the visible tabs in `app/(tabs)/_layout.tsx` (keeps inactive
  tabs rendered so focus doesn't trigger an unfreeze re-render — small CPU cost, ~5 tabs).
  Quick check: `npx expo start --no-dev --minify`.
- [ ] **Boot-splash hold duration.** Confirm the `prefetchHome` hold (`app/_layout.tsx`,
  6s timeout) feels right on a real device + real network, not just the dev machine.
- [x] **RTL live-switch on Android — FIXED (2026-06-25).** Switching Arabic⇄English left the bottom
  tab bar in the old direction because `I18nManager.forceRTL` is a NATIVE setting that needs the
  Android Activity recreated, and the switcher did a JS-only `reloadAppAsync`. Now the LanguageSwitcher
  does a real native restart (`src/lib/restart.ts` → `react-native-restart`, with a `reloadAppAsync`
  fallback). **Verify on the native build** that AR⇄EN flips the tab bar.

## AI / cost (from earlier phases)
- [ ] **Flip the model to Claude at launch:** set `VISION_PROVIDER=anthropic` (+ `ANTHROPIC_API_KEY`)
  so multi-week plan-gen and stronger OCR/analysis turn on. The Groq pilot is free but
  single-week only. No code change — config only.
- [ ] Confirm AI cost accounting (Phase 14c) is recording real token counts once the paid
  model is live (Groq pilot is $0, so dollars only appear after the flip).

## Legal / privacy (gates public surfaces)
- [ ] **Privacy policy (PDPL)** drafted and linked **before** any public profile / leaderboard
  surface goes live (Phases 19–20). Health data (InBody, photos) is sensitive; cover lawful
  basis, EU-Frankfurt transfer basis, AI-processing disclosure, retention, right-to-erasure.
- [ ] **Account delete (Phase 14d)** path verified end-to-end (PDPL erasure): removes PII,
  anonymizes (never hard-deletes) any financial rows.

## Uploads / media
- [ ] Re-confirm the progress-photo / InBody upload path on a release build (the known RN
  `Blob` → `File.bytes()` 0-byte gotcha was a device-only failure).

## Notifications — Phase 17 deferred slices (Slice 1 in-app shipped)
- [x] **Slice 2 — native push (Expo Push). CODE COMPLETE (2026-06-24).** `device_tokens` (0040) +
  `register_device_token` RPC + the `notifications`→`push-send` fan-out trigger (0041, Vault-keyed) +
  the `push-send` Edge Function + `src/lib/push.ts` (mounted in `app/_layout.tsx`) + `app.json`
  plugin + `eas.json`. Deps installed (`expo-notifications`/`expo-device`/`expo-constants`). **No-op
  until activated.** Remaining = external setup + a dev build (the steps below); the full build/setup
  guide is in `docs/phases/phase-17-notifications.md` → "Slice 2 — build + setup".
- [ ] **Activate Slice 2 push (your action; Android-first, all free):** `eas login` + `eas init`;
  Firebase/FCM key via `eas credentials`; set Vault secrets `push_send_url` + `push_send_service_key`;
  deploy `push-send` + apply migrations 0040/0041; `eas build --profile development --platform android`;
  install on a device and confirm message→push→tap. (iOS push needs the Apple Developer account — defer.)
- [ ] **Slice 3 — email + scheduled reminders + smart delivery.** Transactional email (confirm
  Resend/SES on npm), train/eat **reminders** (need a scheduler — `pg_cron` or a cron'd Edge
  Function), quiet hours (UTC→user tz), frequency caps, digest batching. Extend `notification_prefs`
  with channel + quiet-hours columns. Ground default cadence in published engagement research.
- [ ] **New event types** as features land: leaderboard rank change (Phase 20), booking
  request/confirm (Phase 21) — both reuse the 0032 backbone.
- See `docs/phases/phase-17-notifications.md` for the full slice plan.

## Chat safety — Phase 18 (Slices 1–3 shipped + deployed; phase COMPLETE bar the EAS batch)
- [x] **Slice 2 — engagement extras.** Day dividers, reactions (`message_reactions`), soft edit
  (`edited_at` + history-preserving `original_body`), "you're blocked" UX, reliable admin unban.
  Shipped PR #22 + 0036 deployed 2026-06-24.
- [x] **Slice 3 — legal & accountability.** Ban-appeal flow (`ban_appeals` + `resolve-ban-appeal`
  Edge fn), per-person disclaimer **acknowledgment gate** (`chat_acknowledgments`), bilingual
  **Community Guidelines** screen + admin Appeals queue. Migrations 0038/0039. Shipped PR #25 +
  deployed 2026-06-24. **AI auto-moderation DROPPED** (founder: silent chat scanning is intrusive —
  reporting stays the only content path). Device-test fixes PR #26 (self-ref reply embed PGRST200;
  disclaimer-flash) + PR #27 (web bubble-width min-content collapse).

### Phase 18 pilot-review items (decide/verify before the pilot)
- [ ] **Ban is one-directional (send-block only) — confirm this is the desired product rule.**
  A banned client can't *send*, but their **coach can still message them**, and the banned user
  can still **log in and browse** (it's a send-block, not an account lockout). Founder confirmed
  send-block-only is intended for now (2026-06-24). Pre-pilot decision: should a coach→banned-client
  message also be blocked / the thread frozen, and/or should ban become a full lockout (boot-gate on
  `profiles.banned_at`)? All are additive; none built yet by that choice.
- [ ] **Banned-user composer flash.** When a banned user opens a chat, the input is briefly visible
  before `fetchMyBanState` resolves and the "you're blocked" banner replaces it. **Abuse is
  server-mitigated:** the 0034 send trigger rejects every send from a banned account regardless of
  UI (fails closed), so a send during the flash still fails. Cosmetic only. Fix if desired by gating
  the composer until ban-state loads (trade-off: a brief no-composer flash for *all* users) — verify
  on a release build (dev mode amplifies the flash, like the tab-switch artifact above).
- [ ] **Voice notes (EAS dev-build batch).** The one Phase-18 item left, deferred *with* push
  notifications: `audio` kind in the media pipeline (validator/allowlist + `expo-audio` + mic
  permission) — untestable in Expo Go, needs a native build. AI auto-moderation was **dropped**, not
  deferred (founder decision); the appeal flow + legal-escalation copy **shipped** in Slice 3.
- See `docs/phases/phase-18-chat-safety.md` for the full slice plan.

## Auth — "launch auth" follow-up (Phase 14d)
- [x] **Native password-reset deep link — CODE COMPLETE (2026-06-25).** `auth-context.tsx` now parses
  the `gymapp://reset-password?code=…` link on native (cold start + warm), exchanges the PKCE code via
  `exchangeCodeForSession`, and flags recovery so the root guard shows the set-new-password screen. Web
  already worked via `detectSessionInUrl`.
- [ ] **Activate reset (your action):** Supabase → **Auth → URL Configuration** → add redirect URLs
  `gymapp://reset-password` (native) + `<web-origin>/reset-password` (web), and customize the reset email
  template. Then device-test on a native build: forgot-password → email → tap link → set new password.
- [x] **Google OAuth — CODE COMPLETE (2026-06-25).** `src/lib/oauth.ts` (`signInWithGoogle`: web full-page
  redirect; native `expo-web-browser` + PKCE `exchangeCodeForSession`) + a `GoogleSignInButton` on
  sign-in & sign-up. Dep `expo-web-browser` added.
- [ ] **Activate Google (your action):** create a **Google Cloud OAuth client** (Web client for Supabase's
  callback + an Android client for the package `com.mo2adev.gymapp` / SHA-1 from `eas credentials`); in
  Supabase → **Auth → Providers → Google**, paste the client id/secret + turn it on; add `gymapp://` to the
  redirect allowlist. Then device-test on a native build.
- [ ] **Apple OAuth (deferred to iOS):** needs the **Apple Developer account ($99/yr)** (Service ID + key).
  **App-Store-required once Google ships on iOS** (Guideline 4.8) — so it lands with the iOS build, not now.
- [ ] **Phone linking (optional):** configure a paid SMS provider (Twilio) in Supabase before
  exposing `updateUser({ phone })` + OTP. Not a pilot blocker.
- [ ] **Account deactivate:** build the reversible, server-enforced version (account-state flag +
  reactivation gate) — distinct from delete, which is done.
- [ ] **Account delete:** device-test the `account-delete` Edge Function end-to-end (storage objects
  removed + auth user + cascades gone). When `transactions` lands (Phase 23) it must FK
  `on delete set null` and the function must anonymize payer/payee (never hard-delete financial rows).

## Security review (GLM pilot review, 2026-06-28)

**Fixed** in the `cc/security-hardening` track (migrations `0061`–`0068` + Edge fns + config) —
verify after prod apply with `get_advisors(security)`:
- C-1 ban-evasion (account-delete refuses a banned caller + email blocklist `0067`); H-1 audit-trail
  cascade→set-null (`0061`); H-2 push shared-secret 2nd factor (`0068` + config.toml verify_jwt pin);
  M-2 server-side chat disclaimer gate (`0063`); M-3 media-finalize per-kind upload caps; M-4 audio
  MIME in `buckets.sql` (re-apply out-of-band); M-5 accept_invitation atomic no-steal (`0062`);
  M-6 message-update edit-pin (`0063`); M-7 message/food rate-limit tighten + per-recipient cap
  (`0063`/`0064`); M-8 sign-up enumeration removed; L-2 coach-request cap (`0065`); L-9 search
  length caps (`0066`).

**Accepted / known limitations (no code change — revisit if abuse appears):**
- [ ] **H-3 — device-token reassignment** is by-design device handoff; the Expo token is not
  API-readable (`device_tokens_select` is own-row only). Residual risk accepted.
- [ ] **L-1 — no per-coach invitation cap** (creation only inserts a row; confirmed NO server-side
  email send, so no amplification; gated to the vetted `coach` role). Add a trigger cap if abused.
- [ ] **L-4 — coach-leaderboard Sybil** (a coach could fake 3+ clients + self-verify body_metrics to
  inflate "improved"). Expensive attack on a vanity board; add a min-elapsed-time between
  baseline/latest readings + a floor on `coach_public_highlights` if it appears.
- [ ] **L-7 — `is_public_profile` boolean oracle** (returns false for non-public AND non-existent
  ids; UUIDs unguessable; intentionally used by the 0053 trigger). Accepted.
- [ ] **L-8 — wildcard CORS** (`Access-Control-Allow-Origin: *`) is safe with bearer-token auth + no
  `Allow-Credentials`. Tighten only if cookie auth is ever added.
- [ ] **L-10 — web token storage** falls back to `localStorage` (no Keychain in a browser) → XSS-
  readable on the web build only; native pilot unaffected. Mitigate with CSP if web becomes primary.
- **M-8 follow-up:** also enable Supabase Auth's "Prevent user enumeration" setting (dashboard) so
  the *server* response is identical for new vs existing emails (the client is now generic).
- **Push activation (H-2):** when push goes live, set Vault `push_shared_secret` AND the push-send
  env `PUSH_SHARED_SECRET` to the same value, and keep `verify_jwt = true`.
