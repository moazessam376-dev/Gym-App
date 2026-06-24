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

## Deferred to later Slices (tracked in `docs/pre-launch-checklist.md`)

- **Slice 2 — engagement extras:** day dividers (UI-only), reactions
  (`message_reactions`), soft message edit (`edited_at` + a history-preserving UPDATE
  policy), and a "blocked" UX for the banned user (currently the send just fails).
- **Slice 3 — richer safety:** AI auto-moderation (cheap server text check first, AI
  only if needed) gated on **both parties' consent** to disable; voice notes
  (`audio` kind in the media pipeline) with their own moderation; appeal flow; legal
  escalation copy.
