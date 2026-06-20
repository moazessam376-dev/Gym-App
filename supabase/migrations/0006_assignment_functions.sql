-- 0006_assignment_functions.sql
--
-- Phase 2 Slice 2: the ONLY writers of profiles.coach_id and invitation status
-- (CLAUDE.md §2). Both functions run on the trusted server path — invoked from
-- Edge Functions using the service-role key (which connects as the service_role
-- Postgres role).
--
-- These are SECURITY INVOKER (unlike the SECURITY DEFINER *read* helpers in 0001,
-- which need owner privileges to break RLS recursion). Privilege here is NOT
-- ambient: it derives purely from the caller's role. Granted EXCLUSIVELY to
-- service_role, so only the Edge Functions can call them. Run as service_role
-- they BYPASS RLS and satisfy the profiles immutability trigger
-- (current_user = 'service_role', see 0001); run as anyone else the writes would
-- be RLS-gated and the trigger would block the coach_id change — a safe failure.
--
-- Errors are generic on purpose (§4): every failure path raises the same opaque
-- message so a probe can't distinguish "no such token" from "already redeemed".
-- The Edge Function maps these to a single generic client error.
--
-- Idempotent (create or replace) so they can be safely re-pasted into the SQL
-- editor.

-- ── accept_invitation ───────────────────────────────────────────────────────
-- The invitee redeems a single-use, time-boxed token. Atomically: verify the
-- token is pending + unexpired + issued to this email, assign the coach, and
-- consume the token. Returns the assigned coach_id.
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
  v_coach_id   uuid;
  v_email      text;
  v_status     public.invitation_status;
  v_expires_at timestamptz;
begin
  -- FOR UPDATE locks the row so two concurrent redemptions can't both pass the
  -- pending check (single-use guarantee).
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

  -- Defense in depth: the token was issued for a specific email. The Edge
  -- Function passes the caller's VERIFIED email (Supabase Auth getUser), so a
  -- leaked link can't be redeemed by a different account.
  if lower(v_email) is distinct from lower(p_accepting_email) then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  -- Assign the coach. The role = 'client' guard keeps the tenancy model honest
  -- (profiles_coach_only_for_clients) and refuses to "assign" a coach/admin.
  update public.profiles
     set coach_id = v_coach_id
   where id   = p_accepting_user
     and role = 'client';

  if not found then
    raise exception 'invitation_invalid' using errcode = 'P0001';
  end if;

  -- Consume the token (the WHERE above already proved it pending).
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

-- ── assign_client ───────────────────────────────────────────────────────────
-- Direct assignment: a coach links an existing, currently-unassigned client to
-- themselves (no invitation flow). Refuses to reassign a client who already has
-- a coach — stealing another tenant's client is never this path's job.
create or replace function public.assign_client(
  p_coach  uuid,
  p_client uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
     where id = p_coach and role = 'coach'
  ) then
    raise exception 'assignment_invalid' using errcode = 'P0001';
  end if;

  update public.profiles
     set coach_id = p_coach
   where id       = p_client
     and role     = 'client'
     and coach_id is null;

  if not found then
    raise exception 'assignment_invalid' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.assign_client(uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_client(uuid, uuid) to service_role;
