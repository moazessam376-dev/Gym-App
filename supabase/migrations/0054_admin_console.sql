-- 0054_admin_console.sql
--
-- Slice G3 — the admin console's read surface: dashboard counts + a user search, as
-- field-allowlist SECURITY DEFINER RPCs gated IN-FUNCTION on the admin app-role
-- (current_app_role() reads the verified JWT claim — never client input, §5).
--
-- No new table. These are `language sql` functions, so the admin fence is a WHERE clause
-- (`current_app_role() = 'admin'`): a non-admin caller simply matches no rows and gets an
-- empty result — a clean deny with no data leak. Granted to `authenticated` (the fence is
-- inside, not EXECUTE revocation), so advisor 0029 fires for both — that warning is
-- ACCEPTED for these intentional admin RPCs (migrations.md). Idempotent.

-- ── Dashboard counts ─────────────────────────────────────────────────────────
create or replace function public.admin_dashboard_counts()
returns table (
  pending_applications integer,
  open_reports         integer,
  open_appeals         integer,
  coaches              integer,
  clients              integer,
  signups_7d           integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.coach_applications where status = 'pending')::int,
    (select count(*) from public.message_reports     where status = 'open')::int,
    (select count(*) from public.ban_appeals         where status = 'open')::int,
    (select count(*) from public.profiles            where role = 'coach')::int,
    (select count(*) from public.profiles            where role = 'client')::int,
    (select count(*) from public.profiles            where created_at >= now() - interval '7 days')::int
  where public.current_app_role() = 'admin';
$$;

revoke all on function public.admin_dashboard_counts() from public, anon;
grant execute on function public.admin_dashboard_counts() to authenticated, service_role;

-- ── User search (field-allowlist; name ILIKE) ───────────────────────────────
-- p_query is a parameter, never concatenated into SQL structure (§4) — the `||` only
-- builds a LIKE pattern value. Returns the hand-picked columns (no email / coach_id).
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
    and (p_query is null or p_query = '' or p.full_name ilike '%' || p_query || '%')
  order by p.created_at desc
  limit greatest(0, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.admin_search_users(text, integer) from public, anon;
grant execute on function public.admin_search_users(text, integer) to authenticated, service_role;
