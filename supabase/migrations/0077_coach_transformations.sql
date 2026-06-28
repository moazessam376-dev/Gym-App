-- 0077_coach_transformations.sql
--
-- Engagement E3 — the coach transformations showcase (the #1 conversion + virality surface).
-- A coach curates before/after cards of CONSENTING clients; the public coach profile renders
-- them as branded, shareable cards (photos + deltas + tier).
--
-- Privacy (two independent gates, founder-confirmed):
--   * The CLIENT opts in via athlete_profile.allow_transformation_sharing (separate from
--     is_public / share_body_metrics_publicly — a client may be private on the leaderboard yet
--     consent to appear on THEIR coach's profile). Revoking it hides them everywhere instantly.
--   * The COACH curates which consenting clients to feature (this table). A coach can only
--     feature their OWN clients (is_coach_of in the WITH CHECK).
-- The public read path is the field-allowlist RPC below (deltas/duration/tier + media ids —
-- never raw weight/height/sex). The before/after photos use a dedicated, consent-tied
-- `transformation` media kind (0078) — the raw progress_photo read path is NEVER widened.
-- Ships table WITH deny-by-default RLS (§2). Idempotent.

alter table public.athlete_profile
  add column if not exists allow_transformation_sharing boolean not null default false;

create table if not exists public.coach_transformations (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references public.profiles (id) on delete cascade,
  client_id       uuid not null references public.profiles (id) on delete cascade,
  caption         text check (caption is null or char_length(caption) <= 200),
  before_media_id uuid references public.media (id) on delete set null,
  after_media_id  uuid references public.media (id) on delete set null,
  featured_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (coach_id, client_id)
);
create index if not exists coach_transformations_coach_idx on public.coach_transformations (coach_id, featured_at desc);

alter table public.coach_transformations enable row level security;

-- The coach manages their own rows; the featured client may read rows about them.
drop policy if exists coach_transformations_select on public.coach_transformations;
create policy coach_transformations_select on public.coach_transformations
  for select to authenticated
  using (coach_id = auth.uid() or client_id = auth.uid());

-- Insert/update/delete: only the coach, and only featuring a client they actually coach.
drop policy if exists coach_transformations_manage on public.coach_transformations;
create policy coach_transformations_manage on public.coach_transformations
  for all to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and public.is_coach_of(client_id));

grant select, insert, update, delete on public.coach_transformations to authenticated;
grant select on public.coach_transformations to anon;  -- anon: RLS -> 0 rows

-- ── Public showcase RPC (field-allowlist, consent-filtered) ──────────────────
-- Returns the coach's featured transformations with computed deltas + tier — only for
-- clients who STILL consent (allow_transformation_sharing) and only when the coach is public
-- (or the coach previewing their own). First name only (privacy). compute_ffmi/ffmi_tier 0072.
create or replace function public.get_coach_transformations(p_coach_id uuid)
returns table (
  transformation_id     uuid,
  client_first_name     text,
  caption               text,
  before_media_id       uuid,
  after_media_id        uuid,
  duration_weeks        integer,
  body_fat_delta_bp     integer,  -- + = lost
  lean_mass_delta_grams integer,  -- + = gained
  ffmi_before           numeric,
  ffmi_after            numeric,
  tier_before           text,
  tier_after            text,
  goal                  text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''),
    t.caption, t.before_media_id, t.after_media_id,
    case when b.measured_at is not null and l.measured_at is not null
         then greatest(0, (extract(epoch from (l.measured_at - b.measured_at)) / 604800)::int) end,
    case when b.body_fat_bp is not null and l.body_fat_bp is not null then b.body_fat_bp - l.body_fat_bp end,
    case when b.smm is not null and l.smm is not null then l.smm - b.smm end,
    public.compute_ffmi(b.weight_grams, b.body_fat_bp, ap.height_cm),
    public.compute_ffmi(l.weight_grams, l.body_fat_bp, ap.height_cm),
    public.ffmi_tier(public.compute_ffmi(b.weight_grams, b.body_fat_bp, ap.height_cm), ap.sex::text),
    public.ffmi_tier(public.compute_ffmi(l.weight_grams, l.body_fat_bp, ap.height_cm), ap.sex::text),
    ap.primary_goal::text
  from public.coach_transformations t
  join public.athlete_profile ap on ap.user_id = t.client_id
  join public.profiles p on p.id = t.client_id
  left join lateral (
    select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
    from public.body_metrics m
    where m.user_id = t.client_id and m.verified_at is not null
    order by m.measured_at asc, m.created_at asc limit 1
  ) b on true
  left join lateral (
    select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
    from public.body_metrics m
    where m.user_id = t.client_id and m.verified_at is not null
    order by m.measured_at desc, m.created_at desc limit 1
  ) l on true
  where t.coach_id = p_coach_id
    and ap.allow_transformation_sharing
    and (public.is_public_profile(p_coach_id) or p_coach_id = auth.uid())
  order by t.featured_at desc;
$$;
revoke all on function public.get_coach_transformations(uuid) from public, anon;
grant execute on function public.get_coach_transformations(uuid) to authenticated, service_role;
