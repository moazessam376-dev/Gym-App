-- 0066_search_length_caps.sql
--
-- Security L-9 (unbounded ILIKE input). list_public_coaches (0044) and admin_search_users
-- (0054) build a LIKE *value* from a bound parameter (no SQL injection — it's a value,
-- not structure) but never cap its length: a multi-MB p_specialty / p_query forces an
-- expensive scan. list_public_coaches is callable by ANY authenticated user, so it's the
-- material one. Cap the LIKE value at 100 chars. create-or-replace preserves the existing
-- ACL + return shape. Full bodies reproduced (migrations.md). Idempotent.
--
-- NOTE: Track A4 recreates list_public_coaches to add @handle + aggregate outcome columns
-- — that recreation MUST keep this `left(p_specialty, 100)` guard.

-- ── list_public_coaches: bound p_specialty ───────────────────────────────────
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
        where s ilike '%' || left(p_specialty, 100) || '%'
      )
    )
  order by c.years_experience desc nulls last, p.full_name asc
  limit greatest(0, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.list_public_coaches(text, integer, integer) from public, anon;
grant execute on function public.list_public_coaches(text, integer, integer) to authenticated, service_role;

-- ── admin_search_users: bound p_query ────────────────────────────────────────
create or replace function public.admin_search_users(
  p_query text,
  p_limit integer default 50
)
returns table (
  id         uuid,
  full_name  text,
  role       text,
  banned_at  timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role::text, p.banned_at, p.created_at
  from public.profiles p
  where public.current_app_role() = 'admin'
    and (p_query is null or p_query = '' or p.full_name ilike '%' || left(p_query, 100) || '%')
  order by p.created_at desc
  limit greatest(0, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.admin_search_users(text, integer) from public, anon;
grant execute on function public.admin_search_users(text, integer) to authenticated, service_role;
