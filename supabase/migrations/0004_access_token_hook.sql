-- 0004_access_token_hook.sql
--
-- Phase 1: the custom access-token hook (CLAUDE.md §5). Supabase Auth calls this
-- function while minting every JWT and we inject `user_role` into the token's
-- claims, read from public.profiles.role. The role therefore travels inside the
-- VERIFIED, signed token — it can never be supplied by the client. This is the
-- exact claim public.current_app_role() reads (see 0001).
--
-- After applying this migration, register it in the dashboard:
--   Authentication → Hooks → "Customize Access Token (JWT) Claims"
--   → Postgres function: public.custom_access_token_hook

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  v_role public.user_role;
begin
  select p.role
    into v_role
    from public.profiles p
   where p.id = (event ->> 'user_id')::uuid;

  -- No profile yet → null claim; the app routes such users to onboarding.
  claims := jsonb_set(claims, '{user_role}', coalesce(to_jsonb(v_role), 'null'::jsonb));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Supabase Auth invokes the hook as the supabase_auth_admin role. Grant it the
-- minimum needed (execute + read profiles); deny everyone else (defense in depth).
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

grant usage on schema public to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;

-- profiles has RLS enabled; allow the (trusted, internal) auth admin to read
-- roles for the hook. Scoped to SELECT and to supabase_auth_admin only.
-- Idempotent so the migration can be safely re-applied in the SQL editor.
drop policy if exists profiles_auth_admin_read on public.profiles;
create policy profiles_auth_admin_read on public.profiles
  for select to supabase_auth_admin
  using (true);
