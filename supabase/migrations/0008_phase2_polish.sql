-- 0008_phase2_polish.sql
--
-- Phase 2 polish from on-device testing:
--   1. Capture full_name at signup (server-side, via the bootstrap trigger).
--   2. Let a client read THEIR OWN coach's profile (so the app can show it).
--   3. Lock a client to one coach — accept_invitation refuses if already assigned
--      (matches assign_client's no-steal rule).
--   4. Dedupe: at most one PENDING invite per (coach, email).
-- Idempotent so it can be re-pasted into the SQL editor.

-- 1. ── Names at signup ───────────────────────────────────────────────────────
-- handle_new_user now reads `full_name` from the signup metadata
-- (auth.users.raw_user_meta_data, set via supabase.auth.signUp options.data).
-- Still SECURITY DEFINER + pinned search_path (same discipline as 0003).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, full_name)
  values (
    new.id,
    'client',
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do nothing;  -- idempotent: never disturb an existing profile
  return new;
end
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- 2. ── A client may read their own coach's profile ───────────────────────────
-- SECURITY DEFINER helper so the policy doesn't re-enter profiles' RLS and
-- recurse (same pattern + hardening as is_coach_of). Returns the caller's
-- coach_id, or null. Schema-qualified, empty search_path.
create or replace function public.my_coach_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coach_id from public.profiles where id = auth.uid()
$$;

revoke all on function public.my_coach_id() from public;
-- Supabase's default privileges grant EXECUTE to anon too; revoke it explicitly
-- (this is an internal RLS helper — the policy is `to authenticated`, and anon's
-- auth.uid() is null anyway). authenticated keeps it for policy evaluation.
revoke execute on function public.my_coach_id() from anon;
grant execute on function public.my_coach_id() to authenticated, service_role;

-- Additive permissive policy: OR'd with profiles_select, so a client now reads
-- their own row AND their coach's row (and nothing else new).
drop policy if exists profiles_select_own_coach on public.profiles;
create policy profiles_select_own_coach on public.profiles
  for select to authenticated
  using (id = public.my_coach_id());

-- 3. ── One coach per client ──────────────────────────────────────────────────
-- accept_invitation now refuses to reassign a client who already has a coach,
-- and raises a DISTINCT, non-leaky signal for that case (it concerns only the
-- caller's own state, so it's safe to surface as a specific message).
create or replace function public.accept_invitation(
  p_token          uuid,
  p_accepting_user uuid,
  p_accepting_email text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_coach_id      uuid;
  v_email         text;
  v_status        public.invitation_status;
  v_expires_at    timestamptz;
  v_role          public.user_role;
  v_current_coach uuid;
begin
  select coach_id, email, status, expires_at
    into v_coach_id, v_email, v_status, v_expires_at
    from public.invitations
   where token = p_token
   for update;

  if not found
     or v_status <> 'pending'
     or v_expires_at <= now() then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  if lower(v_email) is distinct from lower(p_accepting_email) then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  -- Accepting user must be a client; capture their current coach.
  select role, coach_id
    into v_role, v_current_coach
    from public.profiles
   where id = p_accepting_user;

  if not found or v_role <> 'client' then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  -- One coach per client (matches assign_client). Distinct, non-leaky signal.
  if v_current_coach is not null then
    raise exception 'already_has_coach' using errcode = 'P0001';
  end if;

  update public.profiles
     set coach_id = v_coach_id
   where id = p_accepting_user;

  update public.invitations
     set status      = 'accepted',
         accepted_at = now(),
         accepted_by = p_accepting_user
   where token = p_token;

  return v_coach_id;
end;
$$;

revoke all on function public.accept_invitation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_invitation(uuid, uuid, text) to service_role;

-- 4. ── At most one pending invite per (coach, email) ─────────────────────────
-- Partial unique index: only PENDING rows are constrained, so a coach can
-- re-invite an email whose prior invite was accepted/expired/revoked. Case-
-- insensitive on email. Blocks accidental duplicate spam (full per-coach rate
-- limiting is a later hardening pass).
create unique index if not exists invitations_one_pending_per_email
  on public.invitations (coach_id, lower(email))
  where status = 'pending';
