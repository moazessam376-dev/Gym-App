-- 0044_public_profiles.sql
--
-- Phase 19 (V1) — Public/Private profiles + social foundation.
-- Coaches get an opt-in public PORTFOLIO; athletes an opt-in public profile. Public
-- surfaces are the app's new risk frontier, so privacy is correct from day one:
--
--   * Audience is AUTHENTICATED users only (no `to anon` path in V1). Anonymous /
--     logged-out + shareable links are deferred until the PDPL privacy policy lands.
--   * RLS is row-level, NOT column-level — a raw public read policy on coach_profile /
--     athlete_profile would leak EVERY column of a public row, including sensitive
--     athlete health data (birth_date, height_cm, injuries_notes, sex). So the
--     "public field allowlist" is enforced by SECURITY DEFINER RPCs that hand-pick
--     columns (mirrors coach_body_metrics_board / 0031 coach analytics). The raw
--     tables get NO new read path.
--   * "Client proof" on a coach's page is AGGREGATE / anonymized (no client ids or
--     names) — a named client only ever surfaces if THEY set their own profile public.
--
-- Avatars reuse the media pipeline (0013): a new `avatar` media kind + a single
-- branch on media's RLS so an authenticated viewer can sign the avatar of a PUBLIC
-- profile (kept private-bucket + signed-URL per §7 — no public bucket, no storage
-- policy, since the security boundary is media's table RLS). Idempotent.

-- ── 1. New `avatar` media kind (additive enum value) ─────────────────────────
-- Mirrors 0043's `audio` add. The value is only WRITTEN at runtime by media-finalize.
alter type public.media_kind add value if not exists 'avatar';

-- ── 2. Visibility + portfolio columns (owner-controlled) ─────────────────────
-- `is_public` is the user's OWN toggle (default OFF — private by default per founder),
-- so the existing owner-only UPDATE policies already govern it; no immutability needed.
alter table public.profiles
  add column if not exists avatar_media_id uuid references public.media (id) on delete set null;

alter table public.coach_profile
  add column if not exists is_public    boolean not null default false,
  add column if not exists achievements text[]  not null default '{}';

alter table public.athlete_profile
  add column if not exists is_public           boolean not null default false,
  add column if not exists public_achievements text[]  not null default '{}';

-- ── 3. is_public_profile(uuid): is this user's profile (coach OR athlete) public? ──
-- SECURITY DEFINER so it can read coach_profile/athlete_profile without re-entering
-- their RLS (and so it's callable from media's RLS policy below without recursion —
-- it never reads `media`). search_path pinned + every name schema-qualified (§rls).
create or replace function public.is_public_profile(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.coach_profile  c where c.user_id = p_id and c.is_public)
      or exists (select 1 from public.athlete_profile a where a.user_id = p_id and a.is_public)
$$;

revoke all on function public.is_public_profile(uuid) from public, anon;
grant execute on function public.is_public_profile(uuid) to authenticated, service_role;

-- ── 4. Avatar visibility: extend media's read policy (the intended extension point) ──
-- An authenticated user may sign an `avatar`-kind media row when the owner's profile is
-- public. Progress photos / InBody stay owner/coach/admin only — the `kind='avatar'`
-- guard keeps sensitive health media out of this path. We recreate the WHOLE policy, so
-- it MUST preserve every branch added by earlier migrations: owner / the owner's coach /
-- admin (0013) AND the chat-participant voice-note path (0043). Recreated idempotently.
drop policy if exists media_select on public.media;
create policy media_select on public.media
  for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_coach_of(owner_id)
    or public.current_app_role() = 'admin'
    or public.is_message_media_participant(id)   -- 0043: voice-note recipient
    -- `kind::text` (not the enum literal) so this migration can reference the value
    -- it just ADDED to the enum — Postgres forbids using a new enum value as a literal
    -- in the same transaction, but a text comparison is safe.
    or (kind::text = 'avatar' and public.is_public_profile(owner_id))  -- 0044: public avatar
  );

-- ── 5. Keep avatar_media_id honest: must be the user's OWN avatar media ───────
-- Prevents pointing your avatar at someone else's media row (cosmetic impersonation).
-- SECURITY DEFINER to read `media` regardless of RLS; service role may set anything.
create or replace function public.enforce_avatar_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;
  if new.avatar_media_id is distinct from old.avatar_media_id and new.avatar_media_id is not null then
    if not exists (
      select 1 from public.media m
      where m.id = new.avatar_media_id and m.owner_id = new.id and m.kind::text = 'avatar'
    ) then
      raise exception 'avatar_media_id must reference your own avatar media';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists profiles_enforce_avatar_ownership on public.profiles;
create trigger profiles_enforce_avatar_ownership
  before update on public.profiles
  for each row execute function public.enforce_avatar_ownership();

-- ── 6. Public-read RPCs (THE field allowlist) ────────────────────────────────
-- All SECURITY DEFINER, search_path='', granted to AUTHENTICATED only (never anon).
-- Each returns 0 rows unless the target is public (owner may always preview their own).
-- The SELECT column list IS the allowlist — sensitive columns are simply never selected.

-- 6a. Coach public portfolio.
create or replace function public.get_public_coach_profile(p_coach_id uuid)
returns table (
  coach_id         uuid,
  full_name        text,
  avatar_media_id  uuid,
  bio              text,
  specialties      text[],
  years_experience integer,
  certifications   text,
  achievements     text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.avatar_media_id,
         c.bio, c.specialties, c.years_experience, c.certifications, c.achievements
  from public.coach_profile c
  join public.profiles p on p.id = c.user_id
  where c.user_id = p_coach_id
    and (c.is_public or c.user_id = auth.uid());   -- public, or your own preview
$$;

revoke all on function public.get_public_coach_profile(uuid) from public, anon;
grant execute on function public.get_public_coach_profile(uuid) to authenticated, service_role;

-- 6b. Athlete public profile — MINIMAL allowlist. NEVER birth_date / height_cm /
-- injuries_notes / sex / coach_id (those columns are not in the SELECT, so they
-- cannot be returned regardless of RLS).
create or replace function public.get_public_athlete_profile(p_athlete_id uuid)
returns table (
  athlete_id          uuid,
  full_name           text,
  avatar_media_id     uuid,
  primary_goal        text,
  public_achievements text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.avatar_media_id,
         a.primary_goal::text, a.public_achievements
  from public.athlete_profile a
  join public.profiles p on p.id = a.user_id
  where a.user_id = p_athlete_id
    and (a.is_public or a.user_id = auth.uid());
$$;

revoke all on function public.get_public_athlete_profile(uuid) from public, anon;
grant execute on function public.get_public_athlete_profile(uuid) to authenticated, service_role;

-- 6c. Browse public coaches (seeds the future find-a-coach funnel). Allowlisted summary
-- columns only; optional case-insensitive specialty filter; paginated.
create or replace function public.list_public_coaches(
  p_specialty text default null,
  p_limit     integer default 50,
  p_offset    integer default 0
)
returns table (
  coach_id         uuid,
  full_name        text,
  avatar_media_id  uuid,
  specialties      text[],
  years_experience integer,
  bio              text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.avatar_media_id,
         c.specialties, c.years_experience, c.bio
  from public.coach_profile c
  join public.profiles p on p.id = c.user_id
  where c.is_public
    and (
      p_specialty is null
      or exists (
        select 1 from unnest(c.specialties) s
        where s ilike '%' || p_specialty || '%'
      )
    )
  order by c.years_experience desc nulls last, p.full_name asc
  limit greatest(0, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.list_public_coaches(text, integer, integer) from public, anon;
grant execute on function public.list_public_coaches(text, integer, integer) to authenticated, service_role;

-- 6d. Aggregate, anonymized "goals I help achieve" proof for a PUBLIC coach.
-- Returns ONE row per goal category the coach trains — counts only, NO client ids or
-- names. `improved` = clients with >=2 coach-VERIFIED body-comp readings whose latest
-- moved in a healthy direction (body fat down OR skeletal muscle up) vs baseline
-- (same verified-only lateral-join shape as coach_plan_effectiveness / 0031; 0026's
-- trigger guarantees athletes can't self-inflate these). Owner may preview their own.
create or replace function public.coach_public_highlights(p_coach_id uuid)
returns table (
  primary_goal  text,
  client_count  integer,
  with_progress integer,
  improved      integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with roster as (
    select
      p.id as client_id,
      ap.primary_goal::text as primary_goal,
      b.body_fat_bp  as baseline_bf,
      b.smm_grams    as baseline_smm,
      l.body_fat_bp  as latest_bf,
      l.smm_grams    as latest_smm,
      cnt.n          as verified_n
    from public.profiles p
    left join public.athlete_profile ap on ap.user_id = p.id
    join lateral (
      select count(*)::int as n
      from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null
    ) cnt on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm_grams
      from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null
      order by m.measured_at asc, m.created_at asc
      limit 1
    ) b on true
    left join lateral (
      select m.body_fat_bp, m.skeletal_muscle_mass_grams as smm_grams
      from public.body_metrics m
      where m.user_id = p.id and m.verified_at is not null
      order by m.measured_at desc, m.created_at desc
      limit 1
    ) l on true
    where p.coach_id = p_coach_id
      and exists (
        select 1 from public.coach_profile c
        where c.user_id = p_coach_id and (c.is_public or c.user_id = auth.uid())
      )
  )
  select
    coalesce(primary_goal, 'unspecified') as primary_goal,
    count(*)::int as client_count,
    count(*) filter (where verified_n >= 2)::int as with_progress,
    count(*) filter (
      where verified_n >= 2
        and (
          (latest_bf is not null and baseline_bf is not null and latest_bf < baseline_bf)
          or (latest_smm is not null and baseline_smm is not null and latest_smm > baseline_smm)
        )
    )::int as improved
  from roster
  group by 1
  order by client_count desc;
$$;

revoke all on function public.coach_public_highlights(uuid) from public, anon;
grant execute on function public.coach_public_highlights(uuid) to authenticated, service_role;
