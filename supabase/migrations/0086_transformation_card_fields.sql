-- 0086_transformation_card_fields.sql
--
-- Transformation Card Editor: let a coach (or client, via a submission) author the card —
-- manual stat overrides + dates, a layout choice (side-by-side / top-bottom), and a per-photo
-- framing transform — while keeping the app's VERIFIED-vs-SELF-REPORTED trust model:
--   * VERIFIED  = every displayed stat comes from the client's coach-verified body_metrics
--                 (>=2 readings spanning time) with NO manual override. Only a coach can verify
--                 a body_metric (0026), so a verified card is inherently app-trusted → the card
--                 renders a "Verified" badge.
--   * SELF-REPORTED = any stat is hand-entered (an *_override / a date is set) or the verified
--                 data is absent. Anyone can make one; no badge.
-- Editing framing/layout/caption NEVER changes verified status — only the DATA source does.
--
-- Same override/presentation columns on BOTH coach_transformations (coach path) and
-- transformation_submissions (client path); resolve_transformation_submission copies them.
-- A new field-allowlist RPC get_athlete_transformations lets a client render + share their OWN
-- card and powers the athlete-profile showcase. No RLS change (writes stay on the existing
-- owner-fenced policies); no media policy change (a client's own card media already loads via
-- the 0078 consent+public-coach gate — the Taha case). Idempotent.

-- ── New columns (both tables) ────────────────────────────────────────────────────
alter table public.coach_transformations
  add column if not exists duration_weeks_override       integer check (duration_weeks_override is null or (duration_weeks_override >= 0 and duration_weeks_override <= 520)),
  add column if not exists body_fat_delta_bp_override     integer check (body_fat_delta_bp_override is null or (body_fat_delta_bp_override between -10000 and 10000)),
  add column if not exists lean_mass_delta_grams_override integer check (lean_mass_delta_grams_override is null or (lean_mass_delta_grams_override between -1000000 and 1000000)),
  add column if not exists tier_before_override           text check (tier_before_override is null or tier_before_override in ('bronze','silver','gold','platinum','diamond','master','grandmaster','apex')),
  add column if not exists tier_after_override            text check (tier_after_override is null or tier_after_override in ('bronze','silver','gold','platinum','diamond','master','grandmaster','apex')),
  add column if not exists measurement_started_at         date,
  add column if not exists measurement_ended_at           date,
  add column if not exists layout                         text not null default 'side' check (layout in ('side','stack')),
  add column if not exists before_frame                   jsonb,
  add column if not exists after_frame                    jsonb;

alter table public.transformation_submissions
  add column if not exists duration_weeks_override       integer check (duration_weeks_override is null or (duration_weeks_override >= 0 and duration_weeks_override <= 520)),
  add column if not exists body_fat_delta_bp_override     integer check (body_fat_delta_bp_override is null or (body_fat_delta_bp_override between -10000 and 10000)),
  add column if not exists lean_mass_delta_grams_override integer check (lean_mass_delta_grams_override is null or (lean_mass_delta_grams_override between -1000000 and 1000000)),
  add column if not exists tier_before_override           text check (tier_before_override is null or tier_before_override in ('bronze','silver','gold','platinum','diamond','master','grandmaster','apex')),
  add column if not exists tier_after_override            text check (tier_after_override is null or tier_after_override in ('bronze','silver','gold','platinum','diamond','master','grandmaster','apex')),
  add column if not exists measurement_started_at         date,
  add column if not exists measurement_ended_at           date,
  add column if not exists layout                         text not null default 'side' check (layout in ('side','stack')),
  add column if not exists before_frame                   jsonb,
  add column if not exists after_frame                    jsonb;

-- ── get_coach_transformations — final stats = COALESCE(override, from-dates, from-verified),
--    plus `verified`, `layout`, and the two per-photo frames. Return shape grows → DROP+CREATE
--    and re-apply the full grant block (migrations.md). ─────────────────────────────
drop function if exists public.get_coach_transformations(uuid);
create function public.get_coach_transformations(p_coach_id uuid)
returns table (
  transformation_id     uuid,
  client_first_name     text,
  caption               text,
  before_media_id       uuid,
  after_media_id        uuid,
  duration_weeks        integer,
  body_fat_delta_bp     integer,
  lean_mass_delta_grams integer,
  ffmi_before           numeric,
  ffmi_after            numeric,
  tier_before           text,
  tier_after            text,
  goal                  text,
  verified              boolean,
  layout                text,
  before_frame          jsonb,
  after_frame           jsonb
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
    coalesce(
      t.duration_weeks_override,
      case when t.measurement_started_at is not null and t.measurement_ended_at is not null
           then greatest(0, (t.measurement_ended_at - t.measurement_started_at) / 7) end,
      case when b.measured_at is not null and l.measured_at is not null
           then greatest(0, (extract(epoch from (l.measured_at - b.measured_at)) / 604800)::int) end
    ),
    coalesce(
      t.body_fat_delta_bp_override,
      case when b.body_fat_bp is not null and l.body_fat_bp is not null then b.body_fat_bp - l.body_fat_bp end
    ),
    coalesce(
      t.lean_mass_delta_grams_override,
      case when b.smm is not null and l.smm is not null then l.smm - b.smm end
    ),
    public.compute_ffmi(b.weight_grams, b.body_fat_bp, ap.height_cm),
    public.compute_ffmi(l.weight_grams, l.body_fat_bp, ap.height_cm),
    coalesce(t.tier_before_override, public.ffmi_tier(public.compute_ffmi(b.weight_grams, b.body_fat_bp, ap.height_cm), ap.sex::text)),
    coalesce(t.tier_after_override,  public.ffmi_tier(public.compute_ffmi(l.weight_grams, l.body_fat_bp, ap.height_cm), ap.sex::text)),
    ap.primary_goal::text,
    (t.duration_weeks_override is null and t.body_fat_delta_bp_override is null
       and t.lean_mass_delta_grams_override is null and t.tier_before_override is null
       and t.tier_after_override is null and t.measurement_started_at is null and t.measurement_ended_at is null
       and b.measured_at is not null and l.measured_at is not null and b.measured_at <> l.measured_at),
    t.layout, t.before_frame, t.after_frame
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

-- ── get_athlete_transformations — the CLIENT's own featured card(s), for their athlete profile
--    + self view/share. Same field-allowlist + `verified`, keyed by the athlete; gated on the
--    athlete's public flag (or self) + their transformation-sharing consent. ─────────────────
create function public.get_athlete_transformations(p_athlete_id uuid)
returns table (
  transformation_id     uuid,
  client_first_name     text,
  caption               text,
  before_media_id       uuid,
  after_media_id        uuid,
  duration_weeks        integer,
  body_fat_delta_bp     integer,
  lean_mass_delta_grams integer,
  ffmi_before           numeric,
  ffmi_after            numeric,
  tier_before           text,
  tier_after            text,
  goal                  text,
  verified              boolean,
  layout                text,
  before_frame          jsonb,
  after_frame           jsonb
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
    coalesce(
      t.duration_weeks_override,
      case when t.measurement_started_at is not null and t.measurement_ended_at is not null
           then greatest(0, (t.measurement_ended_at - t.measurement_started_at) / 7) end,
      case when b.measured_at is not null and l.measured_at is not null
           then greatest(0, (extract(epoch from (l.measured_at - b.measured_at)) / 604800)::int) end
    ),
    coalesce(
      t.body_fat_delta_bp_override,
      case when b.body_fat_bp is not null and l.body_fat_bp is not null then b.body_fat_bp - l.body_fat_bp end
    ),
    coalesce(
      t.lean_mass_delta_grams_override,
      case when b.smm is not null and l.smm is not null then l.smm - b.smm end
    ),
    public.compute_ffmi(b.weight_grams, b.body_fat_bp, ap.height_cm),
    public.compute_ffmi(l.weight_grams, l.body_fat_bp, ap.height_cm),
    coalesce(t.tier_before_override, public.ffmi_tier(public.compute_ffmi(b.weight_grams, b.body_fat_bp, ap.height_cm), ap.sex::text)),
    coalesce(t.tier_after_override,  public.ffmi_tier(public.compute_ffmi(l.weight_grams, l.body_fat_bp, ap.height_cm), ap.sex::text)),
    ap.primary_goal::text,
    (t.duration_weeks_override is null and t.body_fat_delta_bp_override is null
       and t.lean_mass_delta_grams_override is null and t.tier_before_override is null
       and t.tier_after_override is null and t.measurement_started_at is null and t.measurement_ended_at is null
       and b.measured_at is not null and l.measured_at is not null and b.measured_at <> l.measured_at),
    t.layout, t.before_frame, t.after_frame
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
  where t.client_id = p_athlete_id
    and ap.allow_transformation_sharing
    and (public.is_public_profile(p_athlete_id) or p_athlete_id = auth.uid())
  order by t.featured_at desc;
$$;
revoke all on function public.get_athlete_transformations(uuid) from public, anon;
grant execute on function public.get_athlete_transformations(uuid) to authenticated, service_role;

-- ── resolve_transformation_submission — copy the new columns submission → coach card. Body-only
--    change (same void return) → CREATE OR REPLACE keeps the ACL. ────────────────────────────
create or replace function public.resolve_transformation_submission(p_submission uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.transformation_submissions%rowtype;
begin
  if p_action not in ('approve', 'dismiss') then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
  select * into s from public.transformation_submissions where id = p_submission;
  if not found or s.coach_id <> auth.uid() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_action = 'approve' then
    insert into public.coach_transformations
      (coach_id, client_id, caption, before_media_id, after_media_id, featured_at,
       duration_weeks_override, body_fat_delta_bp_override, lean_mass_delta_grams_override,
       tier_before_override, tier_after_override, measurement_started_at, measurement_ended_at,
       layout, before_frame, after_frame)
    values (s.coach_id, s.client_id, s.caption, s.before_media_id, s.after_media_id, now(),
       s.duration_weeks_override, s.body_fat_delta_bp_override, s.lean_mass_delta_grams_override,
       s.tier_before_override, s.tier_after_override, s.measurement_started_at, s.measurement_ended_at,
       coalesce(s.layout, 'side'), s.before_frame, s.after_frame)
    on conflict (coach_id, client_id) do update
      set caption                        = excluded.caption,
          before_media_id                = excluded.before_media_id,
          after_media_id                 = excluded.after_media_id,
          featured_at                    = now(),
          duration_weeks_override        = excluded.duration_weeks_override,
          body_fat_delta_bp_override     = excluded.body_fat_delta_bp_override,
          lean_mass_delta_grams_override = excluded.lean_mass_delta_grams_override,
          tier_before_override           = excluded.tier_before_override,
          tier_after_override            = excluded.tier_after_override,
          measurement_started_at         = excluded.measurement_started_at,
          measurement_ended_at           = excluded.measurement_ended_at,
          layout                         = excluded.layout,
          before_frame                   = excluded.before_frame,
          after_frame                    = excluded.after_frame;
    update public.transformation_submissions set status = 'approved' where id = p_submission;
  else
    update public.transformation_submissions set status = 'dismissed' where id = p_submission;
  end if;
end;
$$;
