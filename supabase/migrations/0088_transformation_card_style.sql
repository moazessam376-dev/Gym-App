-- 0088_transformation_card_style.sql
--
-- Card presentation style (founder device-test feedback): at Square/Portrait ratios the
-- top overlay (TRANSFORMATION tag + name + fade scrim) can cover the athlete's face.
-- A per-card `style` jsonb lets the coach (a) move the title INTO the band below the
-- photos and (b) turn the top fade off. Shape today: {"scrim": bool, "title": "top"|"band"}
-- — jsonb (not columns) so future placement tweaks don't need another migration; the app
-- coerces defensively and null = defaults (scrim on, title on top).
--
-- Both tables get the column (the resolve copy stays symmetric); the two public card RPCs
-- grow a `style` column → return-shape change → DROP + CREATE + full grant block
-- (migrations.md); resolve_transformation_submission copies it (body-only → CREATE OR
-- REPLACE keeps the ACL). Idempotent.

alter table public.coach_transformations
  add column if not exists style jsonb;
alter table public.transformation_submissions
  add column if not exists style jsonb;

-- ── get_coach_transformations ────────────────────────────────────────────────────
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
  after_frame           jsonb,
  photos                jsonb,
  style                 jsonb
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
    t.layout, t.before_frame, t.after_frame,
    ph.photos,
    t.style
  from public.coach_transformations t
  join public.athlete_profile ap on ap.user_id = t.client_id
  join public.profiles p on p.id = t.client_id
  left join lateral (
    select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
    from public.body_metrics m
    where m.user_id = t.client_id and m.verified_at is not null
      and (t.before_metric_id is null or m.id = t.before_metric_id)
    order by m.measured_at asc, m.created_at asc limit 1
  ) b on true
  left join lateral (
    select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
    from public.body_metrics m
    where m.user_id = t.client_id and m.verified_at is not null
      and (t.after_metric_id is null or m.id = t.after_metric_id)
    order by m.measured_at desc, m.created_at desc limit 1
  ) l on true
  left join lateral (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'media_id', tp.media_id, 'taken_on', tp.taken_on,
        'frame', tp.frame, 'position', tp.position
      ) order by tp.position),
      '[]'::jsonb
    ) as photos
    from public.transformation_photos tp
    where tp.transformation_id = t.id
  ) ph on true
  where t.coach_id = p_coach_id
    and ap.allow_transformation_sharing
    and (public.is_public_profile(p_coach_id) or p_coach_id = auth.uid())
  order by t.featured_at desc;
$$;
revoke all on function public.get_coach_transformations(uuid) from public, anon;
grant execute on function public.get_coach_transformations(uuid) to authenticated, service_role;

-- ── get_athlete_transformations ──────────────────────────────────────────────────
drop function if exists public.get_athlete_transformations(uuid);
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
  after_frame           jsonb,
  photos                jsonb,
  style                 jsonb
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
    t.layout, t.before_frame, t.after_frame,
    ph.photos,
    t.style
  from public.coach_transformations t
  join public.athlete_profile ap on ap.user_id = t.client_id
  join public.profiles p on p.id = t.client_id
  left join lateral (
    select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
    from public.body_metrics m
    where m.user_id = t.client_id and m.verified_at is not null
      and (t.before_metric_id is null or m.id = t.before_metric_id)
    order by m.measured_at asc, m.created_at asc limit 1
  ) b on true
  left join lateral (
    select m.measured_at, m.weight_grams, m.body_fat_bp, m.skeletal_muscle_mass_grams as smm
    from public.body_metrics m
    where m.user_id = t.client_id and m.verified_at is not null
      and (t.after_metric_id is null or m.id = t.after_metric_id)
    order by m.measured_at desc, m.created_at desc limit 1
  ) l on true
  left join lateral (
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'media_id', tp.media_id, 'taken_on', tp.taken_on,
        'frame', tp.frame, 'position', tp.position
      ) order by tp.position),
      '[]'::jsonb
    ) as photos
    from public.transformation_photos tp
    where tp.transformation_id = t.id
  ) ph on true
  where t.client_id = p_athlete_id
    and ap.allow_transformation_sharing
    and (public.is_public_profile(p_athlete_id) or p_athlete_id = auth.uid())
  order by t.featured_at desc;
$$;
revoke all on function public.get_athlete_transformations(uuid) from public, anon;
grant execute on function public.get_athlete_transformations(uuid) to authenticated, service_role;

-- ── resolve_transformation_submission: copy style too (body-only → OR REPLACE) ────
create or replace function public.resolve_transformation_submission(p_submission uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.transformation_submissions%rowtype;
  v_card uuid;
begin
  if p_action not in ('approve', 'dismiss') then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
  select * into s from public.transformation_submissions where id = p_submission;
  if not found or s.coach_id <> auth.uid() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  -- Approve is an INSERT (multi-card), so resolving twice would duplicate the card —
  -- an already-resolved submission is a silent no-op (double-tap / retry safe).
  if s.status <> 'pending' then
    return;
  end if;

  if p_action = 'approve' then
    insert into public.coach_transformations
      (coach_id, client_id, caption, before_media_id, after_media_id, featured_at,
       duration_weeks_override, body_fat_delta_bp_override, lean_mass_delta_grams_override,
       tier_before_override, tier_after_override, measurement_started_at, measurement_ended_at,
       layout, before_frame, after_frame, style)
    values (s.coach_id, s.client_id, s.caption, s.before_media_id, s.after_media_id, now(),
       s.duration_weeks_override, s.body_fat_delta_bp_override, s.lean_mass_delta_grams_override,
       s.tier_before_override, s.tier_after_override, s.measurement_started_at, s.measurement_ended_at,
       coalesce(s.layout, 'side'), s.before_frame, s.after_frame, s.style)
    returning id into v_card;

    if s.before_media_id is not null then
      insert into public.transformation_photos (transformation_id, media_id, position, frame)
      values (v_card, s.before_media_id, 0, s.before_frame);
    end if;
    if s.after_media_id is not null then
      insert into public.transformation_photos (transformation_id, media_id, position, frame)
      values (v_card, s.after_media_id, 1, s.after_frame);
    end if;

    update public.transformation_submissions set status = 'approved' where id = p_submission;
  else
    update public.transformation_submissions set status = 'dismissed' where id = p_submission;
  end if;
end;
$$;
