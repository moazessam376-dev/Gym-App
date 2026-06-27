-- 0059_harden_conversation_rpcs.sql
--
-- Hardening follow-up to 0058. The two conversation RPCs are SECURITY DEFINER and
-- meant for SIGNED-IN users only. Because they were newly CREATEd (not replaced),
-- Supabase's default privileges auto-granted EXECUTE directly to the `anon` role —
-- and `revoke ... from public` does NOT remove a grant made to `anon` by name. So
-- advisor 0028 (anon can execute a SECURITY DEFINER fn) fired for both. Revoke anon
-- explicitly. (No data was exposed: an anon caller has auth.uid() = null, so
-- list_conversation_previews returns 0 rows and mark_conversation_read errors on the
-- NOT NULL user_id — but anon should not be on the API surface for these at all.)

revoke execute on function public.list_conversation_previews() from anon;
revoke execute on function public.mark_conversation_read(uuid) from anon;
