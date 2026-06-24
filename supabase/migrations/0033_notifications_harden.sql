-- 0033_notifications_harden.sql
--
-- Follow-up to 0032. The four notification trigger functions are SECURITY DEFINER
-- (they must read/insert across tables bypassing RLS). On a fresh function the
-- default grant gives EXECUTE to PUBLIC, which makes them callable as REST RPC
-- endpoints (`/rest/v1/rpc/tg_notify_on_*`) by anon/authenticated — flagged by the
-- security advisor. They can never be usefully called that way (a trigger function
-- errors outside a trigger), but deny-by-default (CLAUDE.md §2/§3) says lock the door.
--
-- Revoking EXECUTE does NOT stop the triggers: Postgres does not check EXECUTE
-- privilege on a function when firing it from a trigger. Idempotent.

revoke all on function public.tg_notify_on_message()        from public;
revoke all on function public.tg_notify_on_metric_comment() from public;
revoke all on function public.tg_notify_on_plan_publish()   from public;
revoke all on function public.tg_notify_on_pr()             from public;

revoke execute on function public.tg_notify_on_message()        from anon, authenticated;
revoke execute on function public.tg_notify_on_metric_comment() from anon, authenticated;
revoke execute on function public.tg_notify_on_plan_publish()   from anon, authenticated;
revoke execute on function public.tg_notify_on_pr()             from anon, authenticated;
