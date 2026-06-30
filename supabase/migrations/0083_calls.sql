-- 0083_calls.sql
--
-- Calls & Meetings — Phase A (booking + scheduling). Two coach<->client call paths, both
-- fenced INSIDE an existing pairing (like messages/0012), shipping their tables WITH RLS in
-- the same migration (deny-by-default, §2). Clones 0053_coach_requests end-to-end.
--
--   Path 1 (client_request): a client requests one of their coach's published time slots;
--     the coach accepts/declines via the service-role resolve_call_request() RPC.
--   Path 2 (coach_adhoc): a coach starts an ad-hoc "Call now" to one of their clients — no
--     booking, no approval. A client can NEVER originate a coach_adhoc call.
--
-- The asymmetry is enforced THREE ways: (1) the BEFORE-INSERT trigger force-derives `origin`
-- from current_app_role(); (2) the RLS INSERT policy's two role-fenced branches; (3) the
-- per-branch tenancy predicates. Privileged columns (room/transaction/workflow) are forced
-- NULL on insert and only the server may transition status (no coach RLS update path).
--
-- The actual call is provider-agnostic and resolved ON-DEMAND at join time (the Jitsi URL is
-- derived from the call id client-side; Phase-B LiveKit mints a per-user token) — so NO room
-- is stored or minted here, which removes any room-mint timing window. Double-booking is
-- guarded by a partial UNIQUE index, never a TOCTOU status check.
--
-- Reuses (does NOT redefine): current_app_role() / is_coach_of() / my_coach_id() (SECURITY
-- DEFINER helpers), emit_notification() + the notification_prefs/type backbone, set_updated_at(),
-- and the existing notifications_push fan-out (0041) which auto-delivers the new types.
-- Idempotent.

-- ════════════════════════ coach_call_slots — dated availability (no recurrence) ════════════════════════
create table if not exists public.coach_call_slots (
  id               uuid primary key default gen_random_uuid(),
  coach_id         uuid not null references public.profiles (id) on delete cascade,
  starts_at        timestamptz not null,                          -- UTC (§11)
  duration_minutes integer not null check (duration_minutes between 5 and 240),
  -- Denormalized UI badge kept in sync by tg_calls_sync_slot — NOT the integrity guard
  -- (that is calls_one_active_per_slot). 'open' bookable; 'held' a pending request;
  -- 'booked' an accepted/active call; 'closed' the coach withdrew it.
  status           text not null default 'open'
                     check (status in ('open', 'held', 'booked', 'closed')),
  created_at       timestamptz not null default now(),            -- UTC (§11)
  updated_at       timestamptz not null default now()
);

-- A client's booking sheet: their coach's bookable future slots, soonest first.
create index if not exists coach_call_slots_open_idx
  on public.coach_call_slots (coach_id, starts_at) where status = 'open';

alter table public.coach_call_slots enable row level security;

drop trigger if exists coach_call_slots_set_updated_at on public.coach_call_slots;
create trigger coach_call_slots_set_updated_at
  before update on public.coach_call_slots
  for each row execute function public.set_updated_at();

-- SELECT: the owning coach (all their slots) or a client of that coach (OPEN slots only,
-- for the booking sheet) or an admin.
drop policy if exists coach_call_slots_select on public.coach_call_slots;
create policy coach_call_slots_select on public.coach_call_slots
  for select to authenticated
  using (
    coach_id = auth.uid()
    or (coach_id = public.my_coach_id() and status = 'open')
    or public.current_app_role() = 'admin'
  );

-- INSERT: a coach publishes only their OWN slot, open.
drop policy if exists coach_call_slots_insert on public.coach_call_slots;
create policy coach_call_slots_insert on public.coach_call_slots
  for insert to authenticated
  with check (
    coach_id = auth.uid()
    and public.current_app_role() = 'coach'
    and status = 'open'
  );

-- UPDATE: a coach toggles their own slot open<->closed only. `using status in ('open','closed')`
-- makes held/booked rows invisible to the update, so a coach can't withdraw a slot with a
-- live booking; `with check` forbids hand-setting held/booked (those follow the call, via
-- tg_calls_sync_slot).
drop policy if exists coach_call_slots_update on public.coach_call_slots;
create policy coach_call_slots_update on public.coach_call_slots
  for update to authenticated
  using      (coach_id = auth.uid() and status in ('open', 'closed'))
  with check (coach_id = auth.uid() and status in ('open', 'closed'));

-- DELETE: a coach removes only an open/closed slot of their own (never held/booked).
drop policy if exists coach_call_slots_delete on public.coach_call_slots;
create policy coach_call_slots_delete on public.coach_call_slots
  for delete to authenticated
  using (coach_id = auth.uid() and status in ('open', 'closed'));

grant select, insert, update, delete on public.coach_call_slots to authenticated;
grant select on public.coach_call_slots to anon;  -- RLS -> 0 rows for anon

-- ════════════════════════════════ calls — both origination paths ════════════════════════════════
create table if not exists public.calls (
  id            uuid primary key default gen_random_uuid(),
  -- Server-derived from the caller's role by the BEFORE-INSERT trigger; a client can NEVER
  -- persist 'coach_adhoc'.
  origin        text not null check (origin in ('client_request', 'coach_adhoc')),
  coach_id      uuid not null references public.profiles (id) on delete cascade,
  client_id     uuid not null references public.profiles (id) on delete cascade,
  client_name   text,                              -- snapshot for the inbox / incoming-call UI
  -- Path 1 only; ON DELETE SET NULL so deleting an old slot never destroys call history
  -- (the time is snapshotted below).
  slot_id       uuid references public.coach_call_slots (id) on delete set null,
  -- Allowlisted purpose CODE, rendered via t('calls.purpose.<code>') — never a localized
  -- label (i18n.md).
  purpose       text check (purpose is null or purpose in
                  ('progress_review', 'plan_adjustment', 'form_check', 'other')),
  -- Unified state machine for both paths (validity per origin enforced below). TEXT+CHECK
  -- (never an enum) so a new state is a one-file CHECK alter, not the two-file dance.
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'ringing', 'in_progress',
                                    'completed', 'declined', 'cancelled', 'expired', 'missed')),
  -- Agreed time: snapshot from the slot (path 1) or now() (path 2) so the call keeps its
  -- time even if the slot row is later deleted (SET NULL above).
  scheduled_at  timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 5 and 240),
  -- Provider-agnostic A/V. room_* are SERVER-minted only (Phase B) and stay null for Jitsi
  -- (the URL is derived from the id at join time). 'jitsi' now; 'livekit' in Phase B.
  provider      text not null default 'jitsi'
                  check (provider in ('jitsi', 'agora', 'daily', 'livekit')),
  room_name     text,
  room_url      text,
  -- Future paid consultations (money.md): a bare nullable placeholder; the FK to
  -- public.transactions is added in the migration that introduces it. No money columns here.
  transaction_id uuid,
  resolved_by   uuid references public.profiles (id) on delete set null,
  resolved_at   timestamptz,
  started_at    timestamptz,                       -- in_progress began
  ended_at      timestamptz,                       -- completed / missed / cancelled
  expires_at    timestamptz,                       -- drives the sweep (pending / ringing)
  reminder_sent_at timestamptz,                    -- guards the pre-call reminder (Phase B)
  created_at    timestamptz not null default now(),  -- UTC (§11)
  updated_at    timestamptz not null default now(),

  -- origin <-> status validity.
  constraint calls_status_for_origin check (
    (origin = 'client_request'
       and status in ('pending', 'accepted', 'in_progress', 'completed', 'declined', 'cancelled', 'expired'))
    or
    (origin = 'coach_adhoc'
       and status in ('ringing', 'in_progress', 'completed', 'cancelled', 'missed'))
  ),
  -- An ad-hoc call never references a published slot.
  constraint calls_slot_only_for_request check (slot_id is null or origin = 'client_request'),
  constraint calls_no_self_call check (coach_id <> client_id)
);

-- THE double-booking guard (race-safe; a status='open' check alone is TOCTOU). At most one
-- non-terminal call may occupy a slot; terminal states drop out of the predicate, so a slot
-- frees up. The losing concurrent INSERT hits 23505 -> the app shows a generic "slot taken".
create unique index if not exists calls_one_active_per_slot
  on public.calls (slot_id)
  where slot_id is not null and status in ('pending', 'accepted', 'in_progress');
-- One live ad-hoc ring per coach<->client pair.
create unique index if not exists calls_one_active_adhoc_per_pair
  on public.calls (coach_id, client_id)
  where origin = 'coach_adhoc' and status in ('ringing', 'in_progress');
-- Coach inbox (pending booking requests, oldest first).
create index if not exists calls_coach_inbox_idx
  on public.calls (coach_id, created_at) where origin = 'client_request' and status = 'pending';
-- Client / coach upcoming-and-past lists.
create index if not exists calls_client_idx on public.calls (client_id, scheduled_at desc);
create index if not exists calls_coach_idx  on public.calls (coach_id, scheduled_at desc);
-- Cheap sweep scan (only pending/ringing rows have a meaningful expires_at).
create index if not exists calls_expiry_scan_idx
  on public.calls (status, expires_at) where status in ('pending', 'ringing');

alter table public.calls enable row level security;

drop trigger if exists calls_set_updated_at on public.calls;
create trigger calls_set_updated_at
  before update on public.calls
  for each row execute function public.set_updated_at();

-- ── assert_bookable_slot — SECURITY DEFINER, used by the SECURITY INVOKER insert trigger so
-- the client's RLS on coach_call_slots is NOT re-entered (the 0082 lesson). Validates the
-- slot is the coach's, OPEN, and future; returns the row so the trigger can snapshot it.
create or replace function public.assert_bookable_slot(p_slot uuid, p_coach uuid)
returns public.coach_call_slots
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row public.coach_call_slots;
begin
  select * into v_row
    from public.coach_call_slots
   where id = p_slot and coach_id = p_coach and status = 'open' and starts_at > now();
  if not found then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- The trigger is SECURITY INVOKER, so the CALLING client must hold EXECUTE. Revoke from
-- public/anon (the by-name anon grant must be revoked explicitly — advisor 0028), grant to
-- authenticated + service_role.
revoke all on function public.assert_bookable_slot(uuid, uuid) from public, anon;
grant execute on function public.assert_bookable_slot(uuid, uuid) to authenticated, service_role;

-- ── Server-set origin / parties / workflow columns (BEFORE INSERT) ──
-- Force-derive origin from current_app_role() and snapshot the parties so the asymmetry
-- can't be forged; validate tenancy via SECURITY DEFINER helpers (no RLS re-entry); apply
-- the rate caps. SECURITY INVOKER; service_role / seed (auth.uid() null) pass through.
create or replace function public.handle_call_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role   public.user_role;
  v_slot   public.coach_call_slots;
  v_recent integer;
begin
  if current_user = 'service_role' then
    return new;
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser (RLS bypassed)
  end if;

  v_role := public.current_app_role();

  -- Null every privileged column (§4 mass-assignment): room/billing/workflow are server-only.
  new.resolved_by := null;
  new.resolved_at := null;
  new.started_at := null;
  new.ended_at := null;
  new.room_name := null;
  new.room_url := null;
  new.transaction_id := null;
  new.reminder_sent_at := null;
  new.provider := 'jitsi';

  if v_role = 'client' then
    new.origin := 'client_request';
    new.client_id := auth.uid();
    new.coach_id := public.my_coach_id();   -- server-derived, never from the body
    new.status := 'pending';
    new.client_name := (select full_name from public.profiles where id = auth.uid());
    if new.coach_id is null then
      raise exception 'request_invalid' using errcode = 'P0001';  -- client has no coach
    end if;
    -- Validate + snapshot the slot via the DEFINER helper (the client can't re-enter slot RLS).
    v_slot := public.assert_bookable_slot(new.slot_id, new.coach_id);
    new.scheduled_at := v_slot.starts_at;
    new.duration_minutes := v_slot.duration_minutes;
    new.expires_at := v_slot.starts_at;
    -- Per-client rolling-24h request cap (mirror 0065).
    select count(*) into v_recent
      from public.calls
     where client_id = auth.uid() and origin = 'client_request'
       and created_at > now() - interval '24 hours';
    if v_recent >= 20 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;

  elsif v_role = 'coach' then
    new.origin := 'coach_adhoc';
    new.coach_id := auth.uid();
    new.status := 'ringing';
    new.slot_id := null;
    new.scheduled_at := now();
    new.expires_at := now() + interval '2 minutes';  -- ring timeout (sweep / app marks missed)
    new.client_name := (select full_name from public.profiles where id = new.client_id);
    -- The target must be THIS coach's client (DEFINER helper, no RLS re-entry).
    if not public.is_coach_of(new.client_id) then
      raise exception 'request_invalid' using errcode = 'P0001';
    end if;
    -- Per-pair rolling-hour ring cap so "Call now" isn't an abuse vector.
    select count(*) into v_recent
      from public.calls
     where coach_id = auth.uid() and client_id = new.client_id and origin = 'coach_adhoc'
       and created_at > now() - interval '1 hour';
    if v_recent >= 10 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;

  else
    raise exception 'request_invalid' using errcode = 'P0001';  -- admin/other can't originate
  end if;

  return new;
end;
$$;

drop trigger if exists calls_handle_insert on public.calls;
create trigger calls_handle_insert
  before insert on public.calls
  for each row execute function public.handle_call_insert();

-- ── Policies (deny-by-default) ──
-- SELECT: the two parties + admin (mirrors coach_requests).
drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls
  for select to authenticated
  using (
    client_id = auth.uid()
    or coach_id = auth.uid()
    or public.current_app_role() = 'admin'
  );

-- INSERT: the asymmetry, declaratively. Branch 1 = client books a request with THEIR coach;
-- Branch 2 = coach rings THEIR client. Privileged columns forced null here AND by the trigger.
-- A client can never satisfy Branch 2 (current_app_role()='coach' + coach_id=auth.uid() +
-- is_coach_of can't hold for a client), and the trigger force-derives origin from role.
drop policy if exists calls_insert on public.calls;
create policy calls_insert on public.calls
  for insert to authenticated
  with check (
    (
      public.current_app_role() = 'client'
      and origin = 'client_request' and status = 'pending'
      and client_id = auth.uid()
      and coach_id = public.my_coach_id()
      and coach_id is not null
      and room_name is null and room_url is null and transaction_id is null
    )
    or
    (
      public.current_app_role() = 'coach'
      and origin = 'coach_adhoc' and status = 'ringing'
      and coach_id = auth.uid()
      and public.is_coach_of(client_id)
      and room_name is null and room_url is null and transaction_id is null
    )
  );

-- UPDATE: the ONLY client-writable transition — self-cancel an own pending OR accepted
-- booking (both pre-start, so a client can bow out without the coach). The slot reopens via
-- tg_calls_sync_slot. Accept/decline + every other lifecycle transition is service-role.
drop policy if exists calls_cancel on public.calls;
create policy calls_cancel on public.calls
  for update to authenticated
  using      (client_id = auth.uid() and origin = 'client_request' and status in ('pending', 'accepted'))
  with check (client_id = auth.uid() and status = 'cancelled');

-- NO DELETE policy (calls are append-only history). NO coach RLS update path.
grant select, insert, update on public.calls to authenticated;
grant select on public.calls to anon;  -- RLS -> 0 rows for anon

-- ── Slot status mirror — the SINGLE writer of coach_call_slots.status for the booking
-- lifecycle, keyed on the call status. SECURITY DEFINER (the client has no UPDATE path on
-- slots) + revoked (a DEFINER trigger fn gets the default PUBLIC execute grant — 0028/0029).
-- Acts only when slot_id is set.
create or replace function public.tg_calls_sync_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.slot_id is null then
    return new;
  end if;
  if new.status = 'pending' then
    update public.coach_call_slots set status = 'held', updated_at = now()
     where id = new.slot_id and status <> 'held';
  elsif new.status in ('accepted', 'in_progress', 'completed') then
    update public.coach_call_slots set status = 'booked', updated_at = now()
     where id = new.slot_id and status <> 'booked';
  elsif new.status in ('declined', 'cancelled', 'expired') then
    update public.coach_call_slots set status = 'open', updated_at = now()
     where id = new.slot_id and status <> 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists calls_sync_slot on public.calls;
create trigger calls_sync_slot
  after insert or update of status on public.calls
  for each row execute function public.tg_calls_sync_slot();

revoke all on function public.tg_calls_sync_slot() from public, anon, authenticated;

-- ── Notify on a new call: the coach for a booking request, the client for an ad-hoc ring.
-- The SINGLE source of call_requested / call_incoming. Carries the call id, NOT a room (the
-- app resolves the join target on-demand). SECURITY DEFINER + revoked.
create or replace function public.tg_notify_on_call()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origin = 'client_request' and new.status = 'pending' then
    perform public.emit_notification(
      new.coach_id, 'call_requested', new.client_id,
      jsonb_build_object('actor_name', new.client_name), 'call', new.id);
  elsif new.origin = 'coach_adhoc' and new.status = 'ringing' then
    perform public.emit_notification(
      new.client_id, 'call_incoming', new.coach_id,
      jsonb_build_object(
        'actor_name', (select full_name from public.profiles where id = new.coach_id),
        'priority', 'high'),
      'call', new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists calls_notify on public.calls;
create trigger calls_notify
  after insert on public.calls
  for each row execute function public.tg_notify_on_call();

revoke all on function public.tg_notify_on_call() from public, anon, authenticated;

-- ════════════════════════ Notification types (4 new) ════════════════════════
-- Mirror 0053's 3-step procedure: extend the CHECK (re-list every existing value), add the
-- per-type pref columns, recreate emit_notification keeping EVERY branch verbatim.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('message', 'coach_comment', 'plan_published', 'pr_achieved', 'client_note',
                  'coach_request', 'call_requested', 'call_accepted', 'call_declined', 'call_incoming'));

alter table public.notification_prefs add column if not exists call_requested boolean not null default true;
alter table public.notification_prefs add column if not exists call_accepted  boolean not null default true;
alter table public.notification_prefs add column if not exists call_declined  boolean not null default true;
alter table public.notification_prefs add column if not exists call_incoming  boolean not null default true;

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
           when 'call_requested' then call_requested
           when 'call_accepted'  then call_accepted
           when 'call_declined'  then call_declined
           when 'call_incoming'  then call_incoming
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

-- ════════════════════════ resolve_call_request — accept / decline (service-role) ════════════════════════
-- SECURITY INVOKER → current_user stays service_role when the JWT-verified Edge Function
-- calls it (RLS bypassed; the coach has no RLS path to flip a call or a held slot). The slot
-- follows the call status automatically via tg_calls_sync_slot (single writer). Generic
-- errors (§4); idempotent on a non-pending row (raises request_invalid).
create or replace function public.resolve_call_request(
  p_call     uuid,
  p_decision text,
  p_coach    uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_client     uuid;
  v_coach_name text;
begin
  if p_decision not in ('accept', 'decline') then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  select client_id
    into v_client
    from public.calls
   where id = p_call and coach_id = p_coach
     and origin = 'client_request' and status = 'pending'
   for update;
  if not found then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  select full_name into v_coach_name from public.profiles where id = p_coach;

  if p_decision = 'accept' then
    update public.calls
       set status = 'accepted', resolved_by = p_coach, resolved_at = now()
     where id = p_call;  -- tg_calls_sync_slot books the slot
    perform public.emit_notification(
      v_client, 'call_accepted', p_coach,
      jsonb_build_object('actor_name', v_coach_name), 'call', p_call);
  else  -- decline
    update public.calls
       set status = 'declined', resolved_by = p_coach, resolved_at = now()
     where id = p_call;  -- tg_calls_sync_slot reopens the slot
    perform public.emit_notification(
      v_client, 'call_declined', p_coach,
      jsonb_build_object('actor_name', v_coach_name), 'call', p_call);
  end if;
end;
$$;

revoke all on function public.resolve_call_request(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.resolve_call_request(uuid, text, uuid) to service_role;

-- ════════════════════════ set_call_status — lifecycle (service-role) ════════════════════════
-- start / complete / miss / cancel, validated against the row's origin + current status;
-- p_actor must be a party. The slot mirror follows via tg_calls_sync_slot. The
-- calls_status_for_origin CHECK is the final backstop (e.g. 'missed' is coach_adhoc-only).
create or replace function public.set_call_status(
  p_call  uuid,
  p_actor uuid,
  p_event text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_event not in ('start', 'complete', 'miss', 'cancel') then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  select status
    into v_status
    from public.calls
   where id = p_call and (coach_id = p_actor or client_id = p_actor)
   for update;
  if not found then
    raise exception 'request_invalid' using errcode = 'P0001';
  end if;

  if p_event = 'start' then
    if v_status not in ('accepted', 'ringing') then
      raise exception 'request_invalid' using errcode = 'P0001';
    end if;
    update public.calls set status = 'in_progress', started_at = now() where id = p_call;
  elsif p_event = 'complete' then
    if v_status not in ('in_progress', 'accepted', 'ringing') then
      raise exception 'request_invalid' using errcode = 'P0001';
    end if;
    update public.calls set status = 'completed', ended_at = now() where id = p_call;
  elsif p_event = 'miss' then
    if v_status not in ('ringing', 'accepted') then
      raise exception 'request_invalid' using errcode = 'P0001';
    end if;
    update public.calls set status = 'missed', ended_at = now() where id = p_call;
  elsif p_event = 'cancel' then
    if v_status not in ('pending', 'accepted', 'ringing') then
      raise exception 'request_invalid' using errcode = 'P0001';
    end if;
    update public.calls set status = 'cancelled', ended_at = now() where id = p_call;
  end if;
end;
$$;

revoke all on function public.set_call_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_call_status(uuid, uuid, text) to service_role;

-- ── Realtime: live call inserts/updates drive the incoming-call banner + lists. Realtime
-- enforces calls_select, so each subscriber receives only their own rows. Guarded: the
-- publication exists on real Supabase but NOT in the local/CI shim (no-op there).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'calls'
    ) then
      alter publication supabase_realtime add table public.calls;
    end if;
  end if;
end
$$;
