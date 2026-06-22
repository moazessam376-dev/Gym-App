-- 0027_ai_usage_events.sql
--
-- Phase 12b: a per-user usage ledger for AI endpoints, the basis for rate limiting
-- (CLAUDE.md §9 — "Rate-limit AI endpoints per user"). The first consumer is the
-- InBody OCR Edge Function (inbody-ocr), capped at 5 attempts/hour/user. It is
-- generic on purpose so later AI features (plan-gen, chat assist, …) reuse the same
-- ledger by adding a new `kind`.
--
-- Append-only + service-role-write-only, exactly like `public.media` (0013): the
-- client NEVER writes this table. The Edge Function (service role) records each
-- attempt and counts the rolling window — so the limit also throttles attempts that
-- fail validation or return garbage, which matters once a paid model (Claude Sonnet
-- at launch) makes every call cost real money. Recording the attempt BEFORE the
-- model call is deliberate: a crash mid-call still consumes a slot (fail-closed).
--
-- An attempt row is logged whether or not the model call succeeds, so a client
-- cannot burn the provider quota by hammering a failing request. Deny-by-default
-- RLS: the owner (and admin) may READ their own usage (to power a "N left this
-- hour" hint); no authenticated INSERT/UPDATE/DELETE policy or grant exists.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ai_usage_kind') then
    -- Only 'inbody_ocr' is used in 12b; the enum is the per-feature rate-limit key.
    create type public.ai_usage_kind as enum ('inbody_ocr');
  end if;
end
$$;

create table if not exists public.ai_usage_events (
  id          uuid primary key default gen_random_uuid(),
  -- The user the AI call was made on behalf of (the caller, server-set).
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        public.ai_usage_kind not null,
  -- The provider that served the call (e.g. 'groq', 'anthropic') — audit only,
  -- never trusted for authorization. Null for an attempt that never reached one.
  provider    text,
  created_at  timestamptz not null default now()  -- UTC (§11); the rolling-window key
);

-- The rate-limit lookup: count a user's recent events of a kind in one index scan.
create index if not exists ai_usage_events_user_kind_created_idx
  on public.ai_usage_events (user_id, kind, created_at desc);

alter table public.ai_usage_events enable row level security;

-- ── Policies (deny-by-default; explicit allows) ─────────────────────────────
-- Read: the owner or an admin. A coach has no business reading another user's AI
-- usage counters, so (unlike body_metrics) there is no is_coach_of() branch here.
drop policy if exists ai_usage_events_select on public.ai_usage_events;
create policy ai_usage_events_select on public.ai_usage_events
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.current_app_role() = 'admin'
  );

-- No INSERT / UPDATE / DELETE policy on purpose: every write goes through an Edge
-- Function as the service role (§2/§9). Append-only — nothing ever updates/deletes.

grant select on public.ai_usage_events to anon, authenticated;  -- anon: RLS -> 0 rows
-- No insert/update/delete grant to authenticated — the trusted server path owns writes.
