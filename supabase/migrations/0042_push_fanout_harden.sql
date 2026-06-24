-- 0042_push_fanout_harden.sql
--
-- Phase 17 (Slice 2) hardening — mirrors 0033_notifications_harden for the push
-- fan-out. The SECURITY DEFINER trigger function created in 0041
-- (tg_push_on_notification) inherits the default EXECUTE-to-PUBLIC grant, so the
-- security advisor flags it as RPC-callable by anon/authenticated via
-- /rest/v1/rpc/. A trigger function must NEVER be callable directly — revoke
-- EXECUTE from the request roles. The trigger still fires: Postgres does not check
-- EXECUTE when firing a trigger.
--
-- Guarded: 0041 only creates the function where pg_net + supabase_vault exist (i.e.
-- NOT in the local/CI shim), so the revoke is skipped there to keep a clean apply.
-- Idempotent.

do $$
begin
  if exists (
    select 1 from pg_proc
     where proname = 'tg_push_on_notification'
       and pronamespace = 'public'::regnamespace
  ) then
    revoke execute on function public.tg_push_on_notification() from public, anon, authenticated;
  end if;
end
$$;
