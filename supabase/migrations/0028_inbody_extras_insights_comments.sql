-- 0028_inbody_extras_insights_comments.sql
--
-- Phase 12b, iteration 2. Three additions, all additive on 0026/0027:
--   1. body_metrics.extras (jsonb) — richer OCR capture beyond the ranked numbers:
--      segmental lean/fat, on-sheet body-composition history, InBody score, body-water
--      ratios, phase angle, etc. It's the CLIENT'S OWN body data, so it lives on the
--      reading and the athlete may read it (RLS unchanged). It never drives ranks.
--   2. body_metric_insights — the AI goal-relative analysis. COACH-ONLY: its RLS
--      deliberately omits the owner, so the athlete cannot read it (the founder's
--      "coach-only" requirement — RLS is row-level, so a coach-only *column* on
--      body_metrics wouldn't hide it; a separate table does). Service-role write only.
--   3. body_metric_comments — the coach leaves comments on a client's InBody; the
--      client reads them (one-way coach→client feedback, scoped to a reading).

-- New AI usage kind for the on-demand analysis endpoint (rate-limited via 0027's ledger).
-- ADD VALUE IF NOT EXISTS is transaction-safe on PG12+ as long as the value isn't used
-- in the same migration (it isn't).
alter type public.ai_usage_kind add value if not exists 'inbody_insight';

-- ── 1. Richer OCR capture (client-readable own data) ────────────────────────
alter table public.body_metrics add column if not exists extras jsonb;

-- ── 2. body_metric_insights — COACH-ONLY AI analysis ────────────────────────
create table if not exists public.body_metric_insights (
  metric_id   uuid primary key references public.body_metrics (id) on delete cascade,
  analysis    text not null,
  provider    text,           -- which AI provider produced it (audit)
  model       text,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.body_metric_insights enable row level security;

drop trigger if exists body_metric_insights_set_updated_at on public.body_metric_insights;
create trigger body_metric_insights_set_updated_at
  before update on public.body_metric_insights
  for each row execute function public.set_updated_at();

-- Read: the metric's COACH or an admin — NOT the owner (this is the coach's private
-- analysis). Writes are service-role only (the inbody-analyze Edge Function).
drop policy if exists body_metric_insights_select on public.body_metric_insights;
create policy body_metric_insights_select on public.body_metric_insights
  for select to authenticated
  using (
    exists (
      select 1 from public.body_metrics m
      where m.id = metric_id
        and (public.is_coach_of(m.user_id) or public.current_app_role() = 'admin')
    )
  );

grant select on public.body_metric_insights to anon, authenticated;  -- anon/owner: RLS -> 0 rows
-- No insert/update/delete grant — the trusted server path (service role) owns writes.

-- ── 3. body_metric_comments — coach → client feedback on a reading ──────────
create table if not exists public.body_metric_comments (
  id          uuid primary key default gen_random_uuid(),
  metric_id   uuid not null references public.body_metrics (id) on delete cascade,
  -- The author (a coach). SERVER-set by the trigger below, never trusted from input.
  author_id   uuid not null references public.profiles (id) on delete cascade,
  body        text not null check (length(btrim(body)) > 0 and length(body) <= 2000),
  created_at  timestamptz not null default now()
);

create index if not exists body_metric_comments_metric_created_idx
  on public.body_metric_comments (metric_id, created_at);

alter table public.body_metric_comments enable row level security;

-- The server owns author identity (mirrors messages 0012 sender_id). SECURITY INVOKER:
-- a BEFORE trigger fires regardless of context and only reads auth.uid() (a caller-scoped
-- GUC) — no elevated rights needed. Pinned search_path; schema-qualified.
create or replace function public.handle_metric_comment_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.author_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists body_metric_comments_handle_insert on public.body_metric_comments;
create trigger body_metric_comments_handle_insert
  before insert on public.body_metric_comments
  for each row execute function public.handle_metric_comment_insert();

-- Read: the reading's owner (client), their coach, or an admin.
drop policy if exists body_metric_comments_select on public.body_metric_comments;
create policy body_metric_comments_select on public.body_metric_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.body_metrics m
      where m.id = metric_id
        and (m.user_id = auth.uid() or public.is_coach_of(m.user_id) or public.current_app_role() = 'admin')
    )
  );

-- Insert: only the reading's COACH or an admin (athletes never comment on their own
-- reading). author_id is server-set, but pin it to the caller in the check too.
drop policy if exists body_metric_comments_insert on public.body_metric_comments;
create policy body_metric_comments_insert on public.body_metric_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.body_metrics m
      where m.id = metric_id
        and (public.is_coach_of(m.user_id) or public.current_app_role() = 'admin')
    )
  );

-- Delete: the comment's author (the coach) or an admin can remove it.
drop policy if exists body_metric_comments_delete on public.body_metric_comments;
create policy body_metric_comments_delete on public.body_metric_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.current_app_role() = 'admin');

grant select, insert, delete on public.body_metric_comments to authenticated;
grant select on public.body_metric_comments to anon;  -- anon: RLS -> 0 rows
