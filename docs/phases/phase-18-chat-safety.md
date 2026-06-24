# Phase 18 — Chat enhancements + safety

Trust & safety for the coach⇄client chat, plus (later) engagement extras. Per the
founder roadmap (`~/.claude/plans/i-have-features-that-snuggly-tome.md`, Tier 3),
**safety is the founder priority**, so this phase is **sliced** the way 16/17 were —
**this doc covers Slice 1 (safety core), which is what ships now.**

---

## Slice 1 — chat safety core (THIS slice)

**Scope (founder-approved):** let a participant **report** a message; give an admin a
**moderation queue** to review and act; enforce a server-controlled **account ban**
that blocks a banned user from sending; surface the in-product **harassment policy**.
Fully testable in Expo Go / web (no native build needed).

### Data model (migration `0034_chat_safety.sql`)

Ships its table **with** RLS in the same migration (deny-by-default, §2).

- **`profiles.banned_at timestamptz`** — server-controlled ban flag (`null` = not
  banned). **Client-immutable** exactly like `role`/`coach_id`: the 0001
  `enforce_profile_immutables` trigger is extended to reject any client-side change to
  `banned_at`. Only the service role flips it.
- **`message_reports`** — a participant flags a message **addressed to them**.
  - `reporter_id` + `reported_user_id` are **server-set** by a `BEFORE INSERT` trigger
    (`handle_message_report_insert`, SECURITY INVOKER): the reporter is `auth.uid()`;
    the reported user is the message's **sender**, derived only if the caller is the
    message's **recipient** (reading `messages` under the caller's own RLS — an
    outsider who can't see the DM, §8, gets `cannot_report_message`).
  - `reported_body` — an **immutable snapshot** of the reported line, captured by the
    same trigger. This is the key §8 move: an admin moderates from the snapshot and
    therefore needs **no live DM read override** (admins still cannot browse a thread).
  - `reason` ∈ {harassment, spam, inappropriate, other}; optional `note` (≤1000).
  - `status` ∈ {open, actioned, dismissed}; `reviewed_by` / `reviewed_at`.
  - `unique (message_id, reporter_id)` — one report per message per reporter.

### RLS

- **read** — the **reporter** (own reports) or an **admin** (the queue). The
  **reported user is deliberately NOT allowed to read** reports filed against them.
- **insert** — as yourself, only `open`/un-reviewed (trigger also enforces the
  "addressed to you" rule + the body snapshot).
- **no UPDATE/DELETE policy** — append-only from the client. Status transitions + the
  ban are written **only** by the service role.

### The moderation write path (no new SECURITY DEFINER functions)

`moderate_message_report(p_report, p_decision, p_reviewer)` is **SECURITY INVOKER**,
granted **only to `service_role`** — the exact `review_coach_application` (0011)
pattern. When the admin-checked Edge Function calls it as the service role,
`current_user` stays `service_role`, so the `profiles` immutability trigger's bypass
fires (lets `banned_at` change) and RLS is bypassed. Because it's invoker-mode +
service-role-only, it raises **no** "public can execute SECURITY DEFINER" advisor
warning (the issue 0033 had to clean up for the 0032 triggers).

Decisions: `dismiss` (close, no action) · `ban` (set the reported user's `banned_at`
+ mark the report `actioned`) · `unban` (clear `banned_at` + `actioned`).

### Ban enforcement

The existing `handle_message_insert` send trigger (0012) gains a check: a sender whose
`profiles.banned_at is not null` is rejected with a generic `banned` error (§4). The
read of their own profile is RLS-permitted, so the invoker-mode trigger sees it.

### Edge Function

`moderate-message-report` — mirrors `review-coach-application`: verify the caller
(Supabase Auth) → authoritative admin check via the **service-role** client reading
`profiles.role` → Zod-validate (`moderateReportSchema`) → call the RPC as the service
role. Generic errors only (§4).

### Client

- `src/schemas/moderation.ts` — `reportMessageSchema` (message_id + reason + optional
  note; reporter/reported are server-set, not in the schema) + `moderateReportSchema`.
- `src/lib/moderation.ts` — `reportMessage` (client insert, RLS-gated),
  `listOpenReports` (admin queue w/ reporter & reported names + ban state),
  `moderateReport` (Edge Function invoke).
- `src/components/ReportMessageSheet.tsx` — long-press reason picker + the policy line.
- `app/chat/[id].tsx` — long-press an **incoming** bubble → report sheet.
- `app/admin/reports.tsx` — admin queue: shows the snapshot, reporter, reason, ban
  state; Dismiss / Ban / Unban with a confirm. Linked from Account (admin only).
- en + ar copy (`report.*`, `moderation.*`, `account.reportedMessages`,
  `common.error`).

### Tests / gates

- RLS block appended to `cases.test.ts` (`chat safety (0034, Phase 18)`): report feed
  RLS (reporter+admin only; reported user excluded; cross-tenant + anon 0 rows);
  report-insert positive control (server-set reporter/reported); cannot report your
  own / an unseen / a duplicate message; append-only (no client UPDATE/DELETE); **ban
  blocks send**; `banned_at` client-immutable; `moderate_message_report` ban path +
  non-admin/clients rejected. Seed gains message `ab000003` + a committed report on it.
- `0034` registered in `runner.ts`. CI: gitleaks + npm-audit + rls.

---

## Slice 2 — chat engagement extras + the banned-user UX (BUILT)

Migration `0036_chat_engagement.sql` (reactions + soft edit). Everything else is
client-only. Testable in Expo Go / web.

- **Day dividers** — UI-only. The inverted thread shows a "Today / Yesterday / date"
  pill above the first (oldest) message of each calendar day. No DB change.
- **Reactions (`message_reactions`)** — a participant reacts to a message in their own
  thread with one of a fixed emoji allowlist (👍 ❤️ 😂 🔥 💪 🎉, mirrored by a DB
  `CHECK` + the `REACTION_EMOJIS` const). `user_id` is **server-set** by a BEFORE-INSERT
  trigger (no forged reactor); RLS limits every row to the **two parties of the
  underlying message** via an `exists (… messages …)` subquery that runs under the
  caller's own RLS — the same trick the report trigger uses, so an outsider (§8) can't
  read or add reactions. Delete is own-only (toggle off). A **banned** account can't
  react (ban = no chat engagement). `replica identity full` so realtime DELETE carries
  the full row → the exact reaction can be removed live. Added to the realtime
  publication.
- **Soft edit (`messages.edited_at` + `original_body`)** — the sender corrects their
  **own** message for a **15-minute window**. A BEFORE-UPDATE trigger owns the
  bookkeeping: it sets `edited_at`, captures the **first** `original_body` once
  (history-preserving — an edit can't silently erase what was said), forbids touching
  `id`/sender/recipient/created_at, blocks edits from a **banned** account, and enforces
  the window. The UPDATE policy is **sender-only**. The UI shows an "edited" marker and
  reflects the counterpart's edits live (the realtime `messages` sub now handles UPDATE).
- **"You're blocked" UX** — the chat reads the caller's own `profiles.banned_at`
  (RLS-permitted: `id = auth.uid()`) on open; a banned user sees a non-interactive
  "You can't send messages" banner **in place of the composer** instead of a silent
  send failure. A `banned` error mid-session (send/edit/react) also flips into that
  state. A banned user can still **report** incoming messages (they may be a victim).
- **Reliable unban (admin)** — the Slice-1 unban path (RPC + Edge fn + button) existed
  but was only reachable from an **open** report, and banning closes the report. Fix is
  **client-only, no new server surface:** every ban flows through a report
  (`moderate_message_report` is the sole writer of `banned_at`), so a still-banned user
  always has an `actioned` report — `listBannedUsers()` surfaces them in a new "Banned
  users" section on `app/admin/reports.tsx`, and Unban reuses
  `moderate_message_report(thatReport, 'unban')`.

**Client:** `src/schemas/message.ts` (+ `editMessageSchema`, `reactToMessageSchema`,
`REACTION_EMOJIS`), `src/lib/messages.ts` (+ `editMessage` / `listReactions` /
`addReaction` / `removeReaction` / `subscribeToReactions`; `subscribeToIncoming` now
also delivers edits), `src/lib/moderation.ts` (+ `listBannedUsers`, `fetchMyBanState`,
`BannedUser`), `src/components/MessageActionsSheet.tsx` (long-press → quick-react row +
Edit/Report), `app/chat/[id].tsx` (dividers, reactions, edit mode, blocked banner),
`app/admin/reports.tsx` (Banned-users section). en+ar copy: `chat.*`,
`moderation.bannedUsersTitle` / `bannedSince`.

**Tests** appended to `cases.test.ts` (`chat engagement (0036, Phase 18 Slice 2)`):
reactions read both-parties / outsider-anon-0, server-set reactor, forged-reactor
overwrite, can't-react-cross-tenant, own-only delete, ban-blocks-react; edit positive
(edited_at + original_body), recipient-can't-edit, immutable-fields raise, edit-window
raise, ban-blocks-edit. Seed gains reaction `4eac0001`. `0036` in `runner.ts`.

**Device-test watch items:** confirm reactions appear **live** on the counterpart's
device (realtime RLS evaluates the participant subquery); confirm the day-divider sits
above the correct (oldest-of-day) message in the inverted list.

## Deferred to Slice 3 (tracked in `docs/pre-launch-checklist.md`)

- **Slice 3 — richer safety:** AI auto-moderation (cheap server text check first, AI
  only if needed) gated on **both parties' consent** to disable; voice notes
  (`audio` kind in the media pipeline) with their own moderation; appeal flow; legal
  escalation copy. Optional engagement follow-ups: reaction notifications, edit-history
  surfacing for moderation.
