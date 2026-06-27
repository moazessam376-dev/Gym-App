-- 0053_coach_requests.sql
--
-- Slice G2 — the "request a coach" funnel. An unassigned client browsing the public
-- coach directory can REQUEST a coach; the coach sees an inbox and accepts (which links
-- them) or declines. Completes the discover → request → accept arc that complements the
-- existing invite flow (coach-initiated).
--
-- Ships its table WITH RLS in the same migration (deny-by-default, §2). Mirrors
-- 0038_ban_appeals exactly: a client-created row whose ownership + workflow columns are
-- SERVER-SET by a BEFORE-INSERT trigger; owner/coach/admin read; the accept/decline +
-- the actual coach link are written ONLY by the service role via resolve_coach_request(),
-- inside a JWT-verified Edge Function. Idempotent.
--
-- Design / security:
--   * client_id, client_name, status are server-set by the trigger — a client can't forge
--     who is requesting nor pre-resolve it. client_name is snapshotted because the
--     requester is NOT yet the coach's client, so profiles RLS would hide their name from
--     the coach (the inbox must still show who's asking) — a short-lived denormalization.
--   * Only an UNASSIGNED client may request, and only a PUBLIC coach may be requested
--     (is_public_profile, 0044) — the discover surface is the only entry point.
--   * A client may cancel their own pending request (UPDATE → 'cancelled' only). Accept /
--     decline + the coach_id write are service-role-only (resolve_coach_request reuses the
--     0006 assign_client guard, the single writer of coach_id).
--   * One OPEN request per (client, coach) — anti-spam partial unique index.

-- ── coach_requests ───────────────────────────────────────────────────────────
create table if not exists public.coach_requests (
  id          uuid primary key default gen_random_uuid(),
  -- Server-set by the trigger below.
  client_id   uuid not null references public.profiles (id) on delete cascade,
  client_name text,
  -- Client-supplied target coach + optional note.
  coach_id    uuid not null references public.profiles (id) on delete cascade,
  message     text check (message is null or char_length(message) <= 500),
  -- Workflow state — flipped to accepted/declined only by the service role; the client
  -- may set 'cancelled' on their own pending row.
  status      text not null default 'pending'
              check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at  timestamptz not null default now(),  -- UTC (§11)
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz
);

-- One OPEN request per (client, coach) — a re-request while one is open is a no-op conflict.
create unique index if not exists coach_requests_one_open
  on public.coach_requests (client_id, coach_id) where status = 'pending';
-- Coach inbox (their pending requests, oldest first).
create index if not exists coach_requests_inbox_idx
  on public.coach_requests (coach_id, created_at) where status = 'pending';

alter table public.coach_requests enable row level security;

-- ── Server-set requester + workflow columns (BEFORE INSERT) ──────────────────
-- Force client_id = auth.uid(), snapshot client_name, default the workflow columns, and
-- require: the caller is an UNASSIGNED client, the target is a PUBLIC coach. SECURITY
-- INVOKER; the reads are the caller's own profile (always permitted) + is_public_profile
-- (a SECURITY DEFINER helper). service_role / seed (auth.uid() null) pass through.
create or replace function public.handle_coach_request_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser (RLS bypassed); not a client request
  end if;

  new.client_id := auth.uid();
  new.client_name := (select full_name from public.profiles where id = auth.uid());
  new.status := 'pending';
  new.resolved_by := null;
  new.resolved_at := null;

  -- Only an unassigned client may request a coach (generic error, §4).
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'client' and coach_id is null
  ) then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  -- The target must be a PUBLIC coach (the discover directory is the only entry point).
  if not exists (
    select 1 from public.profiles where id = new.coach_id and role = 'coach'
  ) or not public.is_public_profile(new.coach_id) then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists coach_requests_handle_insert on public.coach_requests;
create trigger coach_requests_handle_insert
  before insert on public.coach_requests
  for each row execute function public.handle_coach_request_insert();

-- ── Policies (deny-by-default) ───────────────────────────────────────────────
-- Read: the requesting client, the addressed coach, or an admin.
drop policy if exists coach_requests_select on public.coach_requests;
create policy coach_requests_select on public.coach_requests
  for select to authenticated
  using (
    client_id = auth.uid()
    or coach_id = auth.uid()
    or public.current_app_role() = 'admin'
  );

-- Create: as yourself, only 'pending' (the trigger also forces this + the guards).
drop policy if exists coach_requests_insert on public.coach_requests;
create policy coach_requests_insert on public.coach_requests
  for insert to authenticated
  with check (client_id = auth.uid() and status = 'pending');

-- Update: the requesting client may only CANCEL their own pending request. Accept /
-- decline are written by the service role (resolve_coach_request), never the client.
drop policy if exists coach_requests_cancel on public.coach_requests;
create policy coach_requests_cancel on public.coach_requests
  for update to authenticated
  using (client_id = auth.uid() and status = 'pending')
  with check (client_id = auth.uid() and status = 'cancelled');

grant select, insert, update on public.coach_requests to authenticated;
grant select on public.coach_requests to anon;  -- RLS -> 0 rows for anon

-- ── Notification type: coach_request (recipient = coach, actor = client) ─────
-- Mirrors 0050: extend the type CHECK, add the per-type pref column, recreate
-- emit_notification keeping EVERY existing branch verbatim (CREATE OR REPLACE replaces
-- the whole body — migrations.md).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('message', 'coach_comment', 'plan_published', 'pr_achieved', 'client_note', 'coach_request'));

alter table public.notification_prefs
  add column if not exists coach_request boolean not null default true;

create or replace function public.emit_notification(
  p_recipient   uuid,
  p_type        text,
  p_actor       uuid,
  p_params      jsonb,
  p_entity_type text,
  p_entity_id   uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  if p_recipient is null then
    return;
  end if;

  select case p_type
           when 'message'        then message
           when 'coach_comment'  then coach_comment
           when 'plan_published' then plan_published
           when 'pr_achieved'    then pr_achieved
           when 'client_note'    then client_note
           when 'coach_request'  then coach_request
           else true
         end
    into v_enabled
    from public.notification_prefs
   where user_id = p_recipient;

  if v_enabled is false then
    return;
  end if;

  insert into public.notifications
    (recipient_id, type, actor_id, params, entity_type, entity_id)
  values
    (p_recipient, p_type, p_actor, coalesce(p_params, '{}'::jsonb), p_entity_type, p_entity_id);
end;
$$;

revoke all on function public.emit_notification(uuid, text, uuid, jsonb, text, uuid) from public;
revoke execute on function public.emit_notification(uuid, text, uuid, jsonb, text, uuid) from anon, authenticated;
grant execute on function public.emit_notification(uuid, text, uuid, jsonb, text, uuid) to service_role;

-- Trigger: a new coach request → notify the addressed coach.
create or replace function public.tg_notify_on_coach_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.emit_notification(
    new.coach_id,
    'coach_request',
    new.client_id,
    jsonb_build_object('actor_name', new.client_name),
    'coach_request',
    new.id
  );
  return new;
end;
$$;

drop trigger if exists coach_requests_notify on public.coach_requests;
create trigger coach_requests_notify
  after insert on public.coach_requests
  for each row execute function public.tg_notify_on_coach_request();

revoke all on function public.tg_notify_on_coach_request() from public;
revoke execute on function public.tg_notify_on_coach_request() from anon, authenticated;

-- ── resolve_coach_request — the only writer of accept/decline + the coach link ─
-- service_role-only (SECURITY INVOKER → current_user stays service_role when the
-- JWT-verified Edge Function calls it, so the profiles immutability trigger lets coach_id
-- change and RLS is bypassed). Verifies the request is PENDING and addressed to p_coach.
--   accept  → link the client via assign_client (0006, the single coach_id writer), mark
--             this request accepted, and auto-decline the client's other pending requests.
--   decline → mark this request declined.
-- Generic errors (§4); idempotent.
create or replace function public.resolve_coach_request(
  p_request  uuid,
  p_decision text,
  p_coach    uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_client uuid;
begin
  if p_decision not in ('accept', 'decline') then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  select client_id
    into v_client
    from public.coach_requests
   where id = p_request and coach_id = p_coach and status = 'pending'
   for update;
  if not found then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  if p_decision = 'accept' then
    -- Reuses the 0006 guard (client must still be an unassigned client) → raises if not.
    perform public.assign_client(p_coach, v_client);
    update public.coach_requests
       set status = 'accepted', resolved_by = p_coach, resolved_at = now()
     where id = p_request;
    -- The client now has a coach — auto-decline their other open requests.
    update public.coach_requests
       set status = 'declined', resolved_at = now()
     where client_id = v_client and status = 'pending' and id <> p_request;
  else  -- decline
    update public.coach_requests
       set status = 'declined', resolved_by = p_coach, resolved_at = now()
     where id = p_request;
  end if;
end;
$$;

revoke all on function public.resolve_coach_request(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_coach_request(uuid, text, uuid) to service_role;
