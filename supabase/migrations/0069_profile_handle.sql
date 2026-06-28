-- 0069_profile_handle.sql
--
-- U-6: an Instagram-style unique @handle, separate from the free-form display name. The
-- display name (full_name) stays non-unique + freely editable; the handle is the identity
-- anchor — unique, format-constrained, and rate-limited (14-day cooldown) so it isn't an
-- everyday change and can't be used for impersonation/squatting.
--
--   * handle text + a UNIQUE functional index on lower(handle) (case-insensitive unique).
--   * handle_changed_at — drives the cooldown.
--   * generate_handle() — derives a unique, valid handle from the email local-part at
--     signup (collision-suffixed, reserved-word-avoiding).
--   * a BEFORE UPDATE guard: validates format + reserved words + the 14-day cooldown for
--     client edits (service_role bypasses the cooldown), and stamps handle_changed_at.
--   * check_handle_available() — the live availability RPC for the editor.
--   * handle_new_user recreated (full body incl. the 0067 email-blocklist guard) to also
--     assign a generated handle on signup.
-- Idempotent.

-- ── Columns ───────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists handle text;
alter table public.profiles add column if not exists handle_changed_at timestamptz;

create unique index if not exists profiles_handle_unique on public.profiles (lower(handle));

-- ── generate_handle — a unique, valid handle from a base string ───────────────
-- SECURITY DEFINER (reads profiles for uniqueness); internal only (no request-role grant).
create or replace function public.generate_handle(p_base text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_try  text;
  v_n    integer := 0;
  v_reserved text[] := array['admin','coach','support','raptor','gymapp','help','root','system','me','you'];
begin
  -- Lowercase, strip to the allowed alphabet, bound length.
  v_base := regexp_replace(lower(coalesce(p_base, '')), '[^a-z0-9_.]', '', 'g');
  v_base := left(v_base, 18);
  if length(v_base) < 3 then
    v_base := 'user';
  end if;
  v_try := v_base;
  loop
    if v_try <> all(v_reserved)
       and not exists (select 1 from public.profiles where lower(handle) = v_try) then
      return v_try;
    end if;
    v_n := v_n + 1;
    v_try := left(v_base, 15) || v_n::text;
    exit when v_n > 9999;
  end loop;
  -- Extreme fallback (effectively never hit at pilot scale).
  return left(v_base, 8) || floor(random() * 1e8)::bigint::text;
end;
$$;

revoke all on function public.generate_handle(text) from public, anon, authenticated;
grant execute on function public.generate_handle(text) to service_role;

-- ── BEFORE UPDATE guard: format + reserved + 14-day cooldown; stamp changed_at ─
create or replace function public.enforce_handle_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reserved text[] := array['admin','coach','support','raptor','gymapp','help','root','system','me','you'];
begin
  -- Only act when handle actually changes.
  if new.handle is not distinct from old.handle then
    return new;
  end if;

  -- Normalize to lowercase storage.
  if new.handle is not null then
    new.handle := lower(new.handle);
  end if;

  -- Service role is trusted (seed/admin tooling): stamp + skip the cooldown/reserved gate.
  if current_user = 'service_role' then
    new.handle_changed_at := now();
    return new;
  end if;

  if new.handle is not null then
    if new.handle !~ '^[a-z0-9_.]{3,20}$' then
      raise exception 'handle_invalid' using errcode = 'P0001';
    end if;
    if new.handle = any(v_reserved) then
      raise exception 'handle_reserved' using errcode = 'P0001';
    end if;
  end if;

  -- 14-day cooldown between changes (generous edits in the first window are still bounded).
  if old.handle is not null
     and old.handle_changed_at is not null
     and old.handle_changed_at > now() - interval '14 days' then
    raise exception 'handle_cooldown' using errcode = 'P0001';
  end if;

  new.handle_changed_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_handle_guard on public.profiles;
create trigger profiles_handle_guard
  before update on public.profiles
  for each row execute function public.enforce_handle_rules();

-- ── check_handle_available — live availability for the editor ─────────────────
create or replace function public.check_handle_available(p_handle text)
returns table (available boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_h text := lower(coalesce(p_handle, ''));
  v_reserved text[] := array['admin','coach','support','raptor','gymapp','help','root','system','me','you'];
begin
  if v_h !~ '^[a-z0-9_.]{3,20}$' then
    return query select false, 'invalid';
  elsif v_h = any(v_reserved) then
    return query select false, 'reserved';
  elsif exists (
    select 1 from public.profiles
     where lower(handle) = v_h and id <> auth.uid()
  ) then
    return query select false, 'taken';
  else
    return query select true, null::text;
  end if;
end;
$$;

-- Fresh public fn → Supabase grants EXECUTE to anon BY NAME; revoke explicitly (the
-- migrations.md anon-by-name gotcha), then grant only signed-in + server.
revoke all on function public.check_handle_available(text) from public, anon, authenticated;
grant execute on function public.check_handle_available(text) to authenticated, service_role;

-- ── handle_new_user — recreate: email blocklist (0067) + generated handle ─────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Barred email → fail the signup (rolls back the auth.users insert). Generic to client.
  if new.email is not null and exists (
    select 1 from public.email_blocklist where email_lc = lower(new.email)
  ) then
    raise exception 'email_blocked' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, role, full_name, handle, handle_changed_at)
  values (
    new.id,
    'client',
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    public.generate_handle(split_part(coalesce(new.email, ''), '@', 1)),
    now()
  )
  on conflict (id) do nothing;  -- idempotent: never disturb an existing profile
  return new;
end
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
