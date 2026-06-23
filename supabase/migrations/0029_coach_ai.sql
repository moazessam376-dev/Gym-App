-- 0029_coach_ai.sql
--
-- Phase 13 — coach-side AI (plan generation, adjustment nudges, utility AI). All AI
-- here is a COACH tool: it makes the coach faster, and the coach stays the author of
-- everything the athlete sees (no athlete-facing AI). Three additive changes, all
-- layering on the Phase 12b foundation (0027 ledger, the swap-by-config provider):
--   1. New ai_usage_kind values — the per-feature rate-limit keys (§9). The ledger
--      (0027) was built generic exactly so new AI features reuse it via a new `kind`.
--   2. plans.ai_generated — an audit flag set true on AI-drafted plans. Cheap and
--      additive; also seeds the deferred "which plans actually work" cohort analytics.
--   3. plan_insights — the coach-only AI nudge/suggestion text for a client, modeled
--      exactly on body_metric_insights (0028): its RLS deliberately OMITS the owner,
--      so the athlete cannot read the coach's private analysis. Service-role write only.
-- Idempotent so it can be re-pasted. ADD VALUE IF NOT EXISTS is transaction-safe on
-- PG12+ as long as the new values aren't USED in this same migration (they aren't —
-- they're only inserted at runtime by the Edge Functions).

-- ── 1. New per-feature rate-limit keys on the 0027 ledger enum ───────────────
alter type public.ai_usage_kind add value if not exists 'coach_plan_gen';
alter type public.ai_usage_kind add value if not exists 'plan_nudge';
alter type public.ai_usage_kind add value if not exists 'food_macro_fill';
alter type public.ai_usage_kind add value if not exists 'exercise_swap';

-- ── 2. Audit flag: which plans were AI-drafted ──────────────────────────────
-- Server-set true by coach-plan-gen; default false keeps every existing/human plan
-- honest. Never drives access — purely provenance for the coach and future analytics.
alter table public.plans add column if not exists ai_generated boolean not null default false;

-- ── 3. plan_insights — COACH-ONLY AI suggestions for a client ───────────────
-- One current row per client (re-running replaces it). Like body_metric_insights, a
-- coach-only *column* on a shared row wouldn't hide it under row-level RLS, so this is
-- a separate table whose read policy has NO owner branch — the athlete never sees it.
create table if not exists public.plan_insights (
  client_id   uuid primary key references public.profiles (id) on delete cascade,
  analysis    text not null,
  provider    text,           -- which AI provider produced it (audit)
  model       text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),   -- UTC (§11)
  updated_at  timestamptz not null default now()
);

alter table public.plan_insights enable row level security;

drop trigger if exists plan_insights_set_updated_at on public.plan_insights;
create trigger plan_insights_set_updated_at
  before update on public.plan_insights
  for each row execute function public.set_updated_at();

-- Read: the client's COACH or an admin — NOT the client (this is the coach's private
-- decision-support). Writes are service-role only (the coach-plan-nudge Edge Function).
drop policy if exists plan_insights_select on public.plan_insights;
create policy plan_insights_select on public.plan_insights
  for select to authenticated
  using (
    public.is_coach_of(client_id)
    or public.current_app_role() = 'admin'
  );

grant select on public.plan_insights to anon, authenticated;  -- anon/owner: RLS -> 0 rows
-- No insert/update/delete grant — the trusted server path (service role) owns writes.
