# Phase 17 — Notification system (retention engine)

The retention layer for the core loop: tell a user when something that matters to
**them** happens (a message, coach feedback, a new plan, a personal record), so they
come back. It also unblocks later features (bookings reminders, leaderboard rank
alerts) that depend on a notification backbone.

Per the founder roadmap (`~/.claude/plans/i-have-features-that-snuggly-tome.md`,
Tier 2) this phase is **sliced** — the same way Phase 16 shipped Arabic Slice 1 and
deferred the rest. **This doc covers Slice 1 (in-app), which is what ships now.**

---

## Slice 1 — in-app notifications (THIS slice)

**Scope (founder-approved):** an in-app notification **feed** + **unread badge** +
per-user **preferences** + a **server-side event backbone** (DB triggers that emit
notifications RLS-safely). Fully testable in Expo Go / web — no native push, no
EAS build, no email provider needed.

### Event taxonomy (the 4 events wired in Slice 1)

| `type`           | Fires when…                                              | Recipient | Deep-link            |
|------------------|---------------------------------------------------------|-----------|----------------------|
| `message`        | a chat message is sent (coalesced per sender)           | recipient | chat with the sender |
| `coach_comment`  | a coach comments on a client's InBody/body-metric reading | the athlete | body-composition     |
| `plan_published` | a plan becomes `published` (and is assigned to a client) | the athlete | the plan             |
| `pr_achieved`    | a completed set beats the athlete's prior best e1RM (or reps for unloaded) | the athlete (self) | progress             |

### Data model (migration `0032_notifications.sql`)

Two tables, both ship **with** RLS in the same migration (deny-by-default, §2).

- **`notifications`** — the in-app feed. Carries **structured** data, *not*
  pre-rendered text: `type` + `params` (jsonb) + `actor_id` + `entity_type`/`entity_id`.
  The **client renders the localized (en/ar) copy** from `type` + `params` — this is
  what makes the feed bilingual, and it keeps content **minimal** (no message bodies
  leak into the feed table). `read_at` tracks read-state.
  - **RLS:** a recipient reads (`recipient_id = auth.uid()`) and may **delete/dismiss**
    only their own rows. **There is NO client INSERT path** — a client-writable
    notifications table is a spam/impersonation hole. Rows are created **only** by the
    `SECURITY DEFINER` triggers below (and `service_role`). Read-state changes go
    through `mark_notification_read()` / `mark_all_notifications_read()` RPCs (so a
    client can't tamper with `type`/`params` via a blanket UPDATE policy).
  - Realtime: added to the `supabase_realtime` publication (RLS-scoped, like
    `messages`), so the badge updates live.

- **`notification_prefs`** — owner-controlled, one boolean per event type (all default
  **ON**). Owner reads/writes only their own row. Future slices add quiet-hours / tz /
  push + email channel toggles here.

### The event backbone

- **`emit_notification(recipient, type, actor, params, entity_type, entity_id)`** —
  `SECURITY DEFINER`, `search_path=''`. Honors the recipient's per-type pref (default
  ON when no row), then inserts the feed row. EXECUTE revoked from `anon`/`authenticated`
  (internal; only the triggers — which are themselves `SECURITY DEFINER` and owned by
  the same role — and `service_role` can call it).
- **Triggers** (all `SECURITY DEFINER`, `search_path=''`, schema-qualified):
  `messages` (AFTER INSERT, coalesces a burst into one unread row per sender),
  `body_metric_comments` (AFTER INSERT), `plans` (AFTER INSERT OR UPDATE → on the
  draft→published transition only, assigned plans only), `exercise_set_logs`
  (AFTER INSERT OR UPDATE → strict new-best e1RM/reps, first-ever logs are a baseline,
  not a PR; guarded against re-firing on unrelated edits).

### Client

- `src/lib/notifications.ts` — list / unread-count / mark-read / mark-all / delete,
  plus a `describeNotification(type, params)` renderer → `{ icon, title, body, route }`
  (localized via `t()`). Query hooks in `src/lib/queries/home.ts` (cached + warmed in
  `prefetchHome`); a root-level realtime subscription invalidates the feed + badge.
- UI: `app/notifications.tsx` feed (tap → mark read + deep-link), an unread **bell
  badge** in the Client/Coach home headers, and `app/notification-settings.tsx`
  (the 4 toggles) linked from Account.
- i18n: all copy in `en.json` + `ar.json` (Egyptian colloquial).

---

## Deferred — later slices (NOT in this slice)

These are tracked in `docs/pre-launch-checklist.md` and project memory.

- **Slice 2 — native push (Expo Push). CODE COMPLETE (2026-06-24); needs external
  setup + a dev build to activate.** See "Slice 2 — build + setup" below.
- **Slice 3 — email + scheduled reminders + smart delivery.** Transactional email
  (confirm Resend/SES on npm), train/eat **reminders** (need a scheduler — `pg_cron`
  or a cron'd Edge Function; an in-app-only reminder is pointless since you only see it
  once you've already opened the app), quiet hours (UTC→user tz), frequency caps, and
  digest batching. Ground the default cadence in published mobile-notification
  engagement research before shipping.
- **More event types** as their features land: leaderboard rank change (Phase 20),
  booking request/confirm (Phase 21).

## Verification (Slice 1)

- `npm run test:rls` green: cross-tenant denial + positive control on both tables,
  no-client-insert on `notifications`, prefs ownership, and **trigger emission**
  (a message insert creates the recipient's feed row; a pref opt-out suppresses it).
- `npm run typecheck` clean; gitleaks + `npm audit` (CI).
- Device/web: send a message / publish a plan / log a PR → the badge + feed update
  live; tapping deep-links and marks read; toggles in settings suppress the type.

---

## Slice 2 — native push (Expo Push): build + setup

**Architecture (one fan-out point).** Every notification is minted through
`emit_notification()` (0032), so a single AFTER INSERT trigger on `notifications`
(**migration `0041_push_fanout.sql`**) fans every event type out to the **`push-send`**
Edge Function via `pg_net`. push-send loads the recipient's `device_tokens`, renders
the title/body **server-side per device locale** (mirrors `notifications.*` in
`src/i18n/locales/*.json`), and POSTs to the Expo Push API. The coalescing message
UPDATE (0032) is not an INSERT, so a chat burst doesn't re-fire push.

**What's built (in the repo):**
- `device_tokens` registry + `register_device_token(token, platform, locale)` RPC
  (owner-forced; **migration `0040_device_tokens.sql`**) + RLS tests.
- `0041_push_fanout.sql` — the trigger, guarded so the CI shim applies it as a no-op
  (pg_net/Vault absent there). Reads `push_send_url` + `push_send_service_key` from
  **Vault**, never the repo (§3); no-ops if either secret is unset (feed row still created).
- `supabase/functions/push-send/` — service-role-gated; prunes `DeviceNotRegistered` tokens.
- Client: `src/lib/push.ts` (`usePushNotifications`, mounted in `app/_layout.tsx`) — registers
  the token post-auth + routes a tap via `notificationHref`. **No-op in Expo Go / web / simulator.**
- `app.json` `expo-notifications` plugin; `eas.json` (Android-first dev/preview/production).
- Deps installed (SDK-54): `expo-notifications`, `expo-device`, `expo-constants`.

**External setup to activate (all free; Android-first — see `docs/pre-launch-checklist.md`):**
1. **Expo account:** `npx eas login`, then `npx eas init` (writes `extra.eas.projectId` into `app.json`).
2. **Firebase project → FCM** for Android push; upload the FCM key via `eas credentials`
   (or the dashboard). iOS push (APNs) needs the **Apple Developer account ($99/yr)** — defer.
3. **Set the Vault secrets** (Supabase → Project Settings → Vault), so 0041 can deliver:
   - `push_send_url` = `https://ugpxcuocfemhvxhnsvic.supabase.co/functions/v1/push-send`
   - `push_send_service_key` = the project **service-role key** (Vault keeps it off the device/repo).
4. **Deploy** `push-send` (Supabase MCP / dashboard) and **apply** migrations `0040` + `0041`.
   `0041` enables `pg_net` where available.
5. **Build + install:** `npx eas build --profile development --platform android`, install the APK
   on a real device, sign in → permission prompt → token registers.

**Verification (Slice 2):** `npm run test:rls` green (device_tokens denial/positive/RPC,
0041 no-op apply); on a dev build — send a message → push arrives → tap opens the chat;
confirm Supabase advisors clean and a `DeviceNotRegistered` token is pruned.
