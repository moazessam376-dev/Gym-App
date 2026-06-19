-- 0004_access_token_hook.sql
--
-- Phase 1: a Supabase custom access-token hook that injects the user's app role
-- into the JWT as the `user_role` claim, which RLS reads via current_app_role().
-- This is what makes "role comes from the verified JWT, never client input" (§5)
-- true end to end.
--
-- Enable it after deploying — Dashboard: Authentication > Hooks > Customize Access
-- Token, or in supabase/config.toml:
--   [auth.hook.custom_access_token]
--   enabled = true
--   uri = "pg-functions://postgres/public/custom_access_token_hook"

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  if v_role is not null then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role::text));
  end if;

  return jsonb_set(event, '{claims}', claims);
end
$$;

-- The hook is invoked only by GoTrue (supabase_auth_admin). Lock it down.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on public.profiles to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
