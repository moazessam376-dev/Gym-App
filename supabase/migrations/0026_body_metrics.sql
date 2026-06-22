-- Phase 12a — Body-metrics (InBody) + goal-relative, per-coach ranking.
--
-- This is the anti-cheat foundation (foundations.md §4): the body-composition
-- numbers that drive ranks must be SERVER-VERIFIED, never client-asserted. In V1
-- the COACH is the human-in-the-loop — they read the athlete's InBody sheet (the
-- athlete uploads the photo via the existing media pipeline, 0013) and enter the
-- verified numbers. Athletes never write this table. Later (Phase 12b) an Edge
-- Function adds OCR auto-extract (source = 'inbody_ocr') feeding the same
-- coach-confirm step — additive, no schema change.
--
-- Integer units only (foundations.md §3): weight/muscle as grams, body-fat as
-- basis points (body_fat_bp = 1850 → 18.50%). No float body-comp columns, ever.

-- Provenance of a metric row (foundations.md §4). Only 'coach_entered' is used in
-- 12a; the rest are reserved for 12b (OCR) / device imports / unverified self-reports.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'body_metric_source') then
    create type public.body_metric_source as enum
      ('coach_entered', 'inbody_ocr', 'device', 'self_reported');
  end if;
end $$;

create table if not exists public.body_metrics (
  id                          uuid primary key default gen_random_uuid(),
  -- The athlete the metric is about.
  user_id                     uuid not null references public.profiles (id) on delete cascade,
  -- When the scan/test was taken (from the InBody sheet). UTC (§11).
  measured_at                 timestamptz not null default now(),

  -- Body composition — all integers (foundations §3). Weight is required; the
  -- composition fields are nullable so a partial/older sheet still records.
  weight_grams                integer not null check (weight_grams > 0),
  body_fat_bp                 integer check (body_fat_bp is null or (body_fat_bp >= 0 and body_fat_bp <= 10000)),
  skeletal_muscle_mass_grams  integer check (skeletal_muscle_mass_grams is null or skeletal_muscle_mass_grams > 0),
  body_fat_mass_grams         integer check (body_fat_mass_grams is null or body_fat_mass_grams >= 0),
  visceral_fat_level          integer check (visceral_fat_level is null or visceral_fat_level >= 0),
  bmr_kcal                    integer check (bmr_kcal is null or bmr_kcal > 0),

  -- Provenance + verification (the anti-cheat anchor). verified_at/by are
  -- SERVER-STAMPED by the trigger below — never trusted from the client.
  source                      public.body_metric_source not null default 'coach_entered',
  verified_at                 timestamptz,
  verified_by                 uuid references public.profiles (id) on delete set null,
  -- Link to the source InBody scan (0013 media). Dedupe: one metric row per scan.
  media_id                    uuid references public.media (id) on delete set null,

  note                        text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists body_metrics_user_measured_idx
  on public.body_metrics (user_id, measured_at desc);

-- Dedupe by source scan (foundations §4): the same InBody media can't back two
-- metric rows (double-counting). Partial unique — manual rows (no media) are exempt.
create unique index if not exists body_metrics_media_unique
  on public.body_metrics (media_id) where media_id is not null;

alter table public.body_metrics enable row level security;

drop trigger if exists body_metrics_set_updated_at on public.body_metrics;
create trigger body_metrics_set_updated_at
  before update on public.body_metrics
  for each row execute function public.set_updated_at();

-- ── Verification stamp ──────────────────────────────────────────────────────
-- verified_by / verified_at are SERVER-controlled — never trusted from client
-- input, on INSERT or UPDATE. A coach-entered row is verified by the caller at
-- now() (so a coach can't attribute verification to someone else or backdate it).
-- Any other source from a client write is forced UNVERIFIED — closing the hole
-- where a coach could insert source='device'/'self_reported' with a hand-supplied
-- verified_at and have it counted as verified. (12b: OCR rows are inserted
-- unverified by a service function, then verified on coach confirm — which
-- re-stamps via the coach_entered branch / a dedicated SECURITY DEFINER path.)
create or replace function public.stamp_body_metric_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'coach_entered' then
    new.verified_by := auth.uid();
    new.verified_at := now();
  elsif tg_op = 'UPDATE' then
    -- Preserve the existing (server-set) verification; ignore any client change.
    new.verified_by := old.verified_by;
    new.verified_at := old.verified_at;
  else
    -- INSERT of a non-coach_entered source: unverified until a confirm step.
    new.verified_by := null;
    new.verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists body_metrics_stamp_verification on public.body_metrics;
create trigger body_metrics_stamp_verification
  before insert or update on public.body_metrics
  for each row execute function public.stamp_body_metric_verification();

-- ── Policies (deny-by-default) ──────────────────────────────────────────────

-- Read: the athlete, their coach, or an admin (mirrors progress_entries / media).
drop policy if exists body_metrics_select on public.body_metrics;
create policy body_metrics_select on public.body_metrics
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_of(user_id)
    or public.current_app_role() = 'admin'
  );

-- Write: only the athlete's COACH or an admin. Athletes do NOT self-write verified
-- metrics — that is the whole point of server-verification (foundations §4). The
-- WITH CHECK also pins the row to a client the caller actually coaches.
drop policy if exists body_metrics_insert on public.body_metrics;
create policy body_metrics_insert on public.body_metrics
  for insert to authenticated
  with check (public.is_coach_of(user_id) or public.current_app_role() = 'admin');

drop policy if exists body_metrics_update on public.body_metrics;
create policy body_metrics_update on public.body_metrics
  for update to authenticated
  using (public.is_coach_of(user_id) or public.current_app_role() = 'admin')
  with check (public.is_coach_of(user_id) or public.current_app_role() = 'admin');

-- Delete: a coach can remove a mistaken entry for their own client; admin anywhere.
drop policy if exists body_metrics_delete on public.body_metrics;
create policy body_metrics_delete on public.body_metrics
  for delete to authenticated
  using (public.is_coach_of(user_id) or public.current_app_role() = 'admin');

grant select on public.body_metrics to anon, authenticated;          -- anon: RLS -> 0 rows
grant insert, update, delete on public.body_metrics to authenticated;

-- ── coach_body_metrics_board: per-coach cohort, VERIFIED rows only ──────────
-- SECURITY DEFINER so it can read across many clients' metric rows in one pass,
-- fenced HARD by `p.coach_id = auth.uid()` so it can never return another coach's
-- clients. It returns the earliest + latest VERIFIED metric per client (raw integer
-- fields + the client's goal); the APP computes the goal-relative progress score
-- and ranking from these — the scoring formula is a product choice, not a security
-- boundary, and is kept out of the trusted SQL. Non-coach callers are rejected.
create or replace function public.coach_body_metrics_board()
returns table (
  client_id                 uuid,
  full_name                 text,
  primary_goal              text,
  target_weight_grams       integer,
  entries                   integer,
  baseline_at               timestamptz,
  baseline_weight_grams     integer,
  baseline_body_fat_bp      integer,
  baseline_smm_grams        integer,
  latest_at                 timestamptz,
  latest_weight_grams       integer,
  latest_body_fat_bp        integer,
  latest_smm_grams          integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() is distinct from 'coach' then
    raise exception 'not_a_coach' using errcode = 'P0001';
  end if;

  return query
    select
      p.id,
      p.full_name,
      ap.primary_goal::text,
      ap.target_weight_grams,
      cnt.n,
      b.measured_at, b.weight_grams, b.body_fat_bp, b.skeletal_muscle_mass_grams,
      l.measured_at, l.weight_grams, l.body_fat_bp, l.skeletal_muscle_mass_grams
    from public.profiles p
    left join public.athlete_profile ap on ap.user_id = p.id
    join lateral (
      select count(*)::int as n
      from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null
    ) cnt on true
    left join lateral (
      select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams
      from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null
      order by m.measured_at asc, m.created_at asc
      limit 1
    ) b on true
    left join lateral (
      select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams
      from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null
      order by m.measured_at desc, m.created_at desc
      limit 1
    ) l on true
    where p.coach_id = auth.uid()        -- HARD tenancy fence
      and cnt.n > 0;
end;
$$;

revoke all on function public.coach_body_metrics_board() from public, anon;
grant execute on function public.coach_body_metrics_board() to authenticated, service_role;
