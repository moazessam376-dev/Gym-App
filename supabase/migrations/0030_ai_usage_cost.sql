-- 0030_ai_usage_cost.sql
--
-- Phase 14c: AI cost accounting. The ledger (0027) counted *attempts* only — no
-- model, no tokens, no money — so margins (cost per coach/client vs the $3–5 seat
-- price) were not computable. Add the cost columns. They are backfilled by the Edge
-- Function (service role) AFTER the model call returns, since token counts are only
-- known post-call — the attempt row is still inserted BEFORE the call (fail-closed,
-- unchanged). The pilot runs on Groq (free) so these are mostly $0 today, but the
-- columns capture real token counts now so the Claude-launch flip
-- (VISION_PROVIDER=anthropic) immediately yields real dollar costs with no further work.
--
-- Money discipline (§6): cost is an INTEGER in micro-USD (1e-6 USD) — the same
-- integer-units rule as amount_minor / weight_grams. The per-token list prices used
-- to compute it live in the Edge Function (_shared/ai-pricing.ts), not the DB.
--
-- RLS is unchanged and still correct: the 0027 SELECT policy (owner or admin) covers
-- the new columns automatically, and there is still NO authenticated INSERT/UPDATE/
-- DELETE policy. The cost backfill is an UPDATE by the *service role*, which bypasses
-- RLS — exactly like the existing refundUsage DELETE. The client still cannot write.

alter table public.ai_usage_events
  add column if not exists model       text,   -- model id that served the call (e.g. 'claude-sonnet-4-6'); audit + pricing key
  add column if not exists tokens_in   integer,
  add column if not exists tokens_out  integer,
  add column if not exists cost_micros integer; -- integer micro-USD (1e-6 USD); null when model is unpriced / call never completed

-- Defensive non-negative checks (tokens/cost are never negative). Named + guarded so
-- a re-run is a no-op.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ai_usage_events_tokens_nonneg') then
    alter table public.ai_usage_events
      add constraint ai_usage_events_tokens_nonneg
      check (
        (tokens_in is null or tokens_in >= 0)
        and (tokens_out is null or tokens_out >= 0)
        and (cost_micros is null or cost_micros >= 0)
      );
  end if;
end
$$;
