-- 0040_device_tokens.sql
--
-- Phase 17 (Slice 2): native push delivery — the device-token registry the
-- service-role `push-send` Edge Function fans out to. The in-app feed + the
-- event backbone (triggers, prefs, emit_notification) already shipped in
-- 0032_notifications.sql; this only adds WHERE to deliver. Ships its table WITH
-- RLS in the same migration (deny-by-default, CLAUDE.md §2). Idempotent so it can
-- be re-pasted into the SQL editor.
--
-- Design notes:
--   * `token` (the Expo push token) is the natural primary key — one row per
--     device install. Re-registering the same device upserts; a device handed to
--     a new app user reassigns the row to the new owner (handled in the RPC).
--   * There is NO client INSERT/UPDATE policy. Registration goes through the
--     SECURITY DEFINER register_device_token() RPC, which forces
--     user_id = auth.uid() server-side — a client can never register a token under
--     another user's id (that would hijack their push delivery). Same discipline as
--     the mark_*_read() RPCs in 0032.
--   * The recipient may DELETE their own tokens (sign-out / device removal).
--   * service_role reads every row for fan-out (it BYPASSes RLS; the grant lets the
--     statement run). The fan-out trigger itself is wired in a later migration once
--     the push-send function exists (it needs the function URL + a Vault-stored
--     service-role key — never in the repo, CLAUDE.md §3).

-- ── device_tokens ─────────────────────────────────────────────────────────────
create table if not exists public.device_tokens (
  token       text primary key
                check (length(token) between 1 and 512),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android', 'web')),
  -- The device's UI language, so push-send can render the title/body server-side
  -- (unlike the in-app feed, which localizes on-device). NULL => fall back to 'en'.
  locale      text check (locale in ('en', 'ar')),
  created_at  timestamptz not null default now(),   -- UTC (§11)
  updated_at  timestamptz not null default now()    -- UTC (§11)
);

-- Fan-out lookup: "give me every token for this recipient".
create index if not exists device_tokens_user_idx
  on public.device_tokens (user_id);

alter table public.device_tokens enable row level security;

drop trigger if exists device_tokens_set_updated_at on public.device_tokens;
create trigger device_tokens_set_updated_at
  before update on public.device_tokens
  for each row execute function public.set_updated_at();

-- Read: only the owner sees their own device tokens.
drop policy if exists device_tokens_select on public.device_tokens;
create policy device_tokens_select on public.device_tokens
  for select to authenticated
  using (user_id = auth.uid());

-- Delete: the owner may remove their own tokens (sign-out / lost device).
drop policy if exists device_tokens_delete on public.device_tokens;
create policy device_tokens_delete on public.device_tokens
  for delete to authenticated
  using (user_id = auth.uid());

-- NO insert / update policy on purpose: registration is the SECURITY DEFINER RPC
-- below, so user_id is always the verified caller — never client-supplied.
grant select, delete on public.device_tokens to authenticated;
grant select on public.device_tokens to anon;  -- RLS -> 0 rows for anon

-- ── register_device_token — the single, owner-forced upsert path ──────────────
-- SECURITY DEFINER (bypasses the no-INSERT RLS) + pinned search_path. Always
-- stamps user_id = auth.uid(); a re-register from the same device upserts, and a
-- device that's now used by a different app user is reassigned to that user (so a
-- previous owner stops receiving the new owner's notifications). Rejects an
-- unauthenticated caller (auth.uid() is null) by writing nothing.
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

  insert into public.device_tokens (token, user_id, platform, locale)
  values (p_token, auth.uid(), p_platform, p_locale)
  on conflict (token) do update
    set user_id    = auth.uid(),
        platform   = excluded.platform,
        locale     = excluded.locale,
        updated_at = now();
end;
$$;

revoke all on function public.register_device_token(text, text, text) from public;
revoke execute on function public.register_device_token(text, text, text) from anon;
grant execute on function public.register_device_token(text, text, text) to authenticated, service_role;
