-- 0087_transformation_manager.sql
--
-- Transformation Manager (Brand Identity mockup): the coach curates MULTIPLE before/after
-- cards per client, cards can hold 2–4 photos (side/stack/slider for 2, strip for 3, grid
-- for 4) each with an optional presentation-only taken_on date, the VERIFIED path can pin
-- two explicit coach-verified InBody scans, and clients get notified when featured plus a
-- coach "request a transformation" nudge.
--
-- Also FIXES a latent 0078 bug: the media_select transformation branch used a raw subquery
-- on coach_transformations, which re-enters that table's RLS (coach/client only) — so a
-- public coach's showcase photo bytes were never readable by third-party viewers. The branch
-- now goes through a SECURITY DEFINER helper (same pattern as 0043's
-- is_message_media_participant), making the consent-gated public showcase actually public.
--
-- before_media_id / after_media_id STAY as a denormalized first/last mirror of the photo
-- rows: (a) pre-0087 app builds keep writing only them, (b) legacy cards render without
-- child rows (the app synthesizes a 2-photo array), (c) the media policy keeps serving their
-- bytes. A post-pilot cleanup migration can drop them once old builds are retired.
-- transformation_submissions stays 2-photo in v1; approve maps into child rows. Idempotent.

-- ── A. Multi-card: one client can have many published cards ─────────────────────
alter table public.coach_transformations
  drop constraint if exists coach_transformations_coach_id_client_id_key;

create index if not exists coach_transformations_client_idx
  on public.coach_transformations (client_id, featured_at desc);

-- ── B. Layout widens to slider (2 photos) / strip (3) / grid (4) — both tables ──
alter table public.coach_transformations
  drop constraint if exists coach_transformations_layout_check;
alter table public.coach_transformations
  add constraint coach_transformations_layout_check
  check (layout in ('side','stack','slider','strip','grid'));

alter table public.transformation_submissions
  drop constraint if exists transformation_submissions_layout_check;
alter table public.transformation_submissions
  add constraint transformation_submissions_layout_check
  check (layout in ('side','stack','slider','strip','grid'));

-- ── C. Explicit InBody scan pick (coach cards only). Enforcement lives in the RPC
--    laterals below and FAILS CLOSED: a foreign / unverified / dangling id simply
--    matches no row → null stats, never another client's data. ──────────────────
alter table public.coach_transformations
  add column if not exists before_metric_id uuid references public.body_metrics (id) on delete set null,
  add column if not exists after_metric_id  uuid references public.body_metrics (id) on delete set null;

create index if not exists coach_transformations_before_metric_idx
  on public.coach_transformations (before_metric_id);
create index if not exists coach_transformations_after_metric_idx
  on public.coach_transformations (after_metric_id);

-- ── D. transformation_photos: ordered 2–4 photos per card, per-photo frame and an
--    optional taken_on date (PRESENTATION ONLY — stats/weeks never derive from it,
--    they come from scans/dates/overrides like before). ────────────────────────────
create table if not exists public.transformation_photos (
  id                uuid primary key default gen_random_uuid(),
  transformation_id uuid not null references public.coach_transformations (id) on delete cascade,
  media_id          uuid references public.media (id) on delete set null,
  position          smallint not null check (position between 0 and 3),
  taken_on          date,
  frame             jsonb,
  created_at        timestamptz not null default now(),
  unique (transformation_id, position)
);

create index if not exists transformation_photos_media_idx
  on public.transformation_photos (media_id);

alter table public.transformation_photos enable row level security;

-- Mirrors the parent's tenancy: read = the card's coach or the featured client;
-- writes = the card's coach only. Direct subqueries are safe here (the parent's
-- policies never reference this table → no recursion; the parent-RLS re-entry
-- double-filters to the identical row set).
drop policy if exists transformation_photos_select on public.transformation_photos;
create policy transformation_photos_select on public.transformation_photos
  for select to authenticated
  using (exists (
    select 1 from public.coach_transformations ct
    where ct.id = transformation_id
      and (ct.coach_id = auth.uid() or ct.client_id = auth.uid())
  ));

drop policy if exists transformation_photos_manage on public.transformation_photos;
create policy transformation_photos_manage on public.transformation_photos
  for all to authenticated
  using (exists (
    select 1 from public.coach_transformations ct
    where ct.id = transformation_id and ct.coach_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.coach_transformations ct
    where ct.id = transformation_id and ct.coach_id = auth.uid()
  ));

grant select, insert, update, delete on public.transformation_photos to authenticated;
grant select on public.transformation_photos to anon;  -- anon: RLS -> 0 rows

-- Backfill existing cards' before/after into child rows (idempotent via the unique).
insert into public.transformation_photos (transformation_id, media_id, position, frame)
  select id, before_media_id, 0, before_frame
    from public.coach_transformations
   where before_media_id is not null
on conflict (transformation_id, position) do nothing;

insert into public.transformation_photos (transformation_id, media_id, position, frame)
  select id, after_media_id, 1, after_frame
    from public.coach_transformations
   where after_media_id is not null
on conflict (transformation_id, position) do nothing;

-- ── E. media_select: DEFINER membership helper (fixes the 0078 RLS re-entry bug)
--    + full policy recreation preserving EVERY prior branch. ─────────────────────
create or replace function public.is_public_transformation_media(p_media uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.coach_transformations ct
    join public.athlete_profile ap on ap.user_id = ct.client_id
    where (
        ct.before_media_id = p_media
        or ct.after_media_id = p_media
        or exists (
          select 1 from public.transformation_photos tp
          where tp.transformation_id = ct.id and tp.media_id = p_media
        )
      )
      and ap.allow_transformation_sharing
      and public.is_public_profile(ct.coach_id)
  );
$$;
-- Fresh public fn → strip default PUBLIC + by-name anon EXECUTE (advisor 0028 gotcha).
revoke all on function public.is_public_transformation_media(uuid) from public;
revoke execute on function public.is_public_transformation_media(uuid) from anon;
grant execute on function public.is_public_transformation_media(uuid) to authenticated, service_role;

-- Recreate media_select with every branch: owner/coach/admin (0013), voice-note
-- participant (0043), public avatar (0044), consented public transformation (0078,
-- now via the DEFINER helper + transformation_photos membership).
drop policy if exists media_select on public.media;
create policy media_select on public.media
  for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_coach_of(owner_id)
    or public.current_app_role() = 'admin'
    or public.is_message_media_participant(id)                         -- 0043 voice-note recipient
    or (kind::text = 'avatar' and public.is_public_profile(owner_id))  -- 0044 public avatar
    or (kind::text = 'transformation' and public.is_public_transformation_media(id))
  );

-- ── F. Public card RPCs — return shape grows a `photos` array → DROP + CREATE and
--    re-apply the FULL grant block (migrations.md). The b/l laterals gain the
--    metric-pick fence; everything else is 0086's logic verbatim. ────────────────
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
  photos                jsonb
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
    ph.photos
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
  photos                jsonb
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
    ph.photos
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

-- ── G. resolve_transformation_submission — approve now INSERTS a new card (multi-
--    card model) and materializes the submission's two photos as child rows.
--    Body-only change (same void return) → CREATE OR REPLACE keeps the ACL. ──────
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

-- ── H. Notifications: two new kinds, feature trigger, nudge RPC ──────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('message', 'coach_comment', 'plan_published', 'pr_achieved', 'client_note',
                  'coach_request', 'call_requested', 'call_accepted', 'call_declined', 'call_incoming',
                  'transformation_featured', 'transformation_requested'));

alter table public.notification_prefs
  add column if not exists transformation_featured   boolean not null default true,
  add column if not exists transformation_requested  boolean not null default true;

-- Recreate emit_notification keeping EVERY existing pref branch verbatim + the two new ones.
create or replace function public.emit_notification(
  p_recipient uuid, p_type text, p_actor uuid, p_params jsonb, p_entity_type text, p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_enabled boolean;
begin
  if p_recipient is null then return; end if;
  select case p_type
           when 'message' then message when 'coach_comment' then coach_comment
           when 'plan_published' then plan_published when 'pr_achieved' then pr_achieved
           when 'client_note' then client_note when 'coach_request' then coach_request
           when 'call_requested' then call_requested when 'call_accepted' then call_accepted
           when 'call_declined' then call_declined when 'call_incoming' then call_incoming
           when 'transformation_featured' then transformation_featured
           when 'transformation_requested' then transformation_requested
           else true end
    into v_enabled from public.notification_prefs where user_id = p_recipient;
  if v_enabled is false then return; end if;
  insert into public.notifications (recipient_id, type, actor_id, params, entity_type, entity_id)
  values (p_recipient, p_type, p_actor, coalesce(p_params, '{}'::jsonb), p_entity_type, p_entity_id);
end; $$;

-- Featured notification: AFTER INSERT covers BOTH paths (resolve-RPC approve and the
-- coach editor's direct create). Edits / featured_at bumps never re-notify; the D-step
-- backfill above only inserts child rows, so applying this migration notifies no one.
create or replace function public.tg_notify_on_transformation_featured()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_name text;
begin
  select full_name into v_name from public.profiles where id = new.coach_id;
  perform public.emit_notification(
    new.client_id, 'transformation_featured', new.coach_id,
    jsonb_build_object('actor_name', coalesce(v_name, '')),
    'transformation', new.id
  );
  return new;
end; $$;
-- SECURITY DEFINER trigger fn: not an RPC — strip ALL execute grants (advisor 0028/0029).
revoke all on function public.tg_notify_on_transformation_featured() from public, anon, authenticated;

drop trigger if exists notify_on_transformation_featured on public.coach_transformations;
create trigger notify_on_transformation_featured
  after insert on public.coach_transformations
  for each row execute function public.tg_notify_on_transformation_featured();

-- Nudge: the coach asks a client to submit a transformation. Fenced on is_coach_of,
-- deduped to one request per coach→client per 7 days (errcode-tagged so the app can
-- toast the right copy). Suppressed-by-prefs requests don't insert a row, so a muted
-- client could be re-asked — accepted (the mute is the client's choice).
create or replace function public.request_transformation(p_client uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_name text;
begin
  if not public.is_coach_of(p_client) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.notifications
    where recipient_id = p_client
      and type = 'transformation_requested'
      and actor_id = auth.uid()
      and created_at > now() - interval '7 days'
  ) then
    raise exception 'too_soon' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.profiles where id = auth.uid();
  perform public.emit_notification(
    p_client, 'transformation_requested', auth.uid(),
    jsonb_build_object('actor_name', coalesce(v_name, '')),
    'transformation_request', null
  );
end; $$;
-- Fresh public fn → strip default PUBLIC + by-name anon EXECUTE grants (advisor 0028).
revoke all on function public.request_transformation(uuid) from public;
revoke execute on function public.request_transformation(uuid) from anon;
grant execute on function public.request_transformation(uuid) to authenticated, service_role;
