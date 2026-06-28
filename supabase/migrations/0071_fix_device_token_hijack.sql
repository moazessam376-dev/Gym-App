-- 0071_fix_device_token_hijack.sql
--
-- Security H-3 (Expo push-token hijack). 0040's register_device_token() upsert did
-- `on conflict (token) do update set user_id = auth.uid()` — so ANY authenticated
-- caller who learned a victim's Expo push token (logs, a shared device, a leaked
-- crash dump) could call the RPC with that token and have the row REASSIGNED to
-- themselves. Impact: the victim silently stops receiving push (denial), and the
-- victim's physical device starts receiving the attacker's notifications. The hijack
-- needs only the token STRING, not the device.
--
-- Fix: never reassign a token owned by a DIFFERENT user. The conflict update is now
-- guarded by `where device_tokens.user_id = auth.uid()`, so:
--   * token is new                       → INSERT, owned by the caller.
--   * token already owned by the caller  → UPDATE platform/locale (idempotent re-register).
--   * token owned by someone else        → WHERE is false → no-op (NOT reassigned).
-- A remote attacker therefore cannot detach or claim a victim's token.
--
-- Legitimate device hand-off (a real shared device, a new app user) still works
-- because sign-out DELETES the device's token (the owner DELETE policy + src/lib/push.ts),
-- so the next user registers a fresh row with no conflict. We deliberately do NOT
-- reassign on a live conflict — that is exactly the hijack vector. A token left behind
-- by a user who never signed out is a far higher bar (physical possession) and is the
-- accepted residual.
--
-- This is a create-or-replace of an EXISTING function, so its ACL is preserved; the
-- revoke/grant lines below are restated for clarity + idempotency (match 0040). No
-- schema/RLS change, no new table. Idempotent so it can be re-pasted.

create or replace function public.register_device_token(
  p_token    text,
  p_platform text,
  p_locale   text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;  -- not authenticated — nothing to register
  end if;
  if p_token is null or length(p_token) = 0 or length(p_token) > 512 then
    raise exception 'invalid token';
  end if;
  if p_platform not in ('ios', 'android', 'web') then
    raise exception 'invalid platform';
  end if;
  if p_locale is not null and p_locale not in ('en', 'ar') then
    raise exception 'invalid locale';
  end if;

  -- Owner-guarded upsert: a token owned by a different user is left untouched
  -- (H-3 — no cross-user reassignment). user_id is NEVER changed on conflict.
  insert into public.device_tokens (token, user_id, platform, locale)
  values (p_token, auth.uid(), p_platform, p_locale)
  on conflict (token) do update
    set platform   = excluded.platform,
        locale     = excluded.locale,
        updated_at = now()
    where device_tokens.user_id = auth.uid();
end;
$$;

revoke all on function public.register_device_token(text, text, text) from public;
revoke execute on function public.register_device_token(text, text, text) from anon;
grant execute on function public.register_device_token(text, text, text) to authenticated, service_role;
