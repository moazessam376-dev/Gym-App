-- 0062_accept_invitation_atomic.sql
--
-- Security M-5 (concurrent-invitation race). accept_invitation (0008) reads the client's
-- current coach and raises `already_has_coach` if non-null, but the subsequent
-- `update profiles set coach_id = … where id = p_accepting_user` had NO `and coach_id is
-- null` guard and locked only the INVITATIONS row (not the profiles row). Two concurrent
-- accepts of different tokens (two coaches who each invited the same client) both read
-- coach_id = null, both pass the check, and the second UPDATE overwrites coach_id —
-- last-write-wins, both invitations marked accepted.
--
-- Fix: make the UPDATE atomic with the same guard assign_client (0006) already uses —
-- `where id = … and role = 'client' and coach_id is null` + raise on `not found`. The
-- second concurrent UPDATE then matches 0 rows and is rejected. The pre-read raise is
-- kept as the friendly, non-leaky `already_has_coach` signal for the common case; the
-- WHERE clause is the correctness backstop. create-or-replace preserves the existing ACL
-- (service_role-only). Full body reproduced (migrations.md). Idempotent.

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

  -- Accepting user must be a client; capture their current coach for the friendly signal.
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

  -- Atomic no-steal: the second concurrent accept matches 0 rows here and is rejected,
  -- closing the read-then-write race (the friendly raise above can't see a sibling's
  -- in-flight UPDATE; this WHERE clause can).
  update public.profiles
     set coach_id = v_coach_id
   where id = p_accepting_user and role = 'client' and coach_id is null;
  if not found then
    raise exception 'already_has_coach' using errcode = 'P0001';
  end if;

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
