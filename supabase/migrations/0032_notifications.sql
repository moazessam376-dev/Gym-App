-- 0032_notifications.sql
--
-- Phase 17 (Slice 1): in-app notification feed + per-user preferences + a
-- server-side event backbone. NO native push / email yet (deferred slices —
-- see docs/phases/phase-17-notifications.md). Ships its tables WITH RLS in the
-- same migration (deny-by-default, CLAUDE.md §2). Idempotent so it can be
-- re-pasted into the SQL editor.
--
-- Design notes:
--   * notifications carries STRUCTURED data (type + params jsonb + entity link),
--     NOT pre-rendered text — the client renders localized (en/ar) copy. This keeps
--     the feed bilingual AND keeps content minimal (no message bodies leak here).
--   * Rows are created ONLY by the SECURITY DEFINER triggers below (and service_role).
--     There is NO client INSERT path — a client-writable notifications table would be
--     a spam / impersonation hole. Read-state changes go through the mark_*_read()
--     RPCs (so a blanket UPDATE policy can't be abused to tamper with type/params).
--   * emit_notification() honors the recipient's per-type preference (default ON).

-- ── notification_prefs — owner-controlled, one boolean per event type ─────────
create table if not exists public.notification_prefs (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  message        boolean not null default true,
  coach_comment  boolean not null default true,
  plan_published boolean not null default true,
  pr_achieved    boolean not null default true,
  updated_at     timestamptz not null default now()  -- UTC (§11)
);

alter table public.notification_prefs enable row level security;

drop trigger if exists notification_prefs_set_updated_at on public.notification_prefs;
create trigger notification_prefs_set_updated_at
  before update on public.notification_prefs
  for each row execute function public.set_updated_at();

-- Owner reads / writes only their own preferences row.
drop policy if exists notification_prefs_select on public.notification_prefs;
create policy notification_prefs_select on public.notification_prefs
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notification_prefs_insert on public.notification_prefs;
create policy notification_prefs_insert on public.notification_prefs
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists notification_prefs_update on public.notification_prefs;
create policy notification_prefs_update on public.notification_prefs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.notification_prefs to authenticated;
grant select on public.notification_prefs to anon;  -- RLS -> 0 rows for anon

-- ── notifications — the in-app feed ──────────────────────────────────────────
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  -- The 4 Slice-1 event types (the client maps each to localized copy + a route).
  type         text not null
                 check (type in ('message', 'coach_comment', 'plan_published', 'pr_achieved')),
  -- Who caused it (sender / coach / the athlete themselves for a PR). Nullable so a
  -- deleted actor doesn't cascade-delete the recipient's feed history.
  actor_id     uuid references public.profiles (id) on delete set null,
  -- Interpolation values for the localized string (e.g. actor_name, exercise_name,
  -- plan_title). Deliberately small — minimal content lives in the feed.
  params       jsonb not null default '{}'::jsonb,
  -- Deep-link target for the tap (entity_type tells the client which route).
  entity_type  text,
  entity_id    uuid,
  read_at      timestamptz,                         -- null = unread
  created_at   timestamptz not null default now()   -- UTC (§11)
);

-- Feed (newest first) + a partial index for the cheap unread-badge count.
create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_recipient_unread_idx
  on public.notifications (recipient_id) where read_at is null;

alter table public.notifications enable row level security;

-- Read: only the recipient (a personal feed — no admin override, like messages §8).
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_id = auth.uid());

-- Delete: the recipient may dismiss / clear their own rows.
drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (recipient_id = auth.uid());

-- NO insert / update policy on purpose:
--   * INSERT is server-side only (the SECURITY DEFINER triggers / service_role) — a
--     client must never be able to mint notifications for another user.
--   * read_at flips through the mark_*_read() RPCs below (a column-restricted path),
--     so we don't expose a blanket UPDATE that could rewrite type/params.
grant select, delete on public.notifications to authenticated;
grant select on public.notifications to anon;  -- RLS -> 0 rows for anon

-- ── emit_notification — the single, pref-aware insert path ────────────────────
-- SECURITY DEFINER (bypasses the no-INSERT RLS) + pinned search_path. Honors the
-- recipient's per-type opt-out (default ON when there's no prefs row). Internal:
-- EXECUTE is revoked from anon/authenticated so a client can't call it directly to
-- spam; the triggers (also SECURITY DEFINER, same owner) and service_role can.
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

  -- Per-recipient, per-type preference. A missing row (null) => send (default ON);
  -- only an explicit `false` suppresses.
  select case p_type
           when 'message'        then message
           when 'coach_comment'  then coach_comment
           when 'plan_published' then plan_published
           when 'pr_achieved'    then pr_achieved
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

-- ── Trigger: new chat message → notify the recipient (coalesced) ──────────────
-- AFTER INSERT (sender_id is already server-set by the 0012 BEFORE trigger). To keep
-- a chat burst from stacking the feed, an existing UNREAD message notification from
-- the same sender is just bumped instead of duplicated ("New message from X" once
-- until read). SECURITY DEFINER so the cross-row read/update/insert bypass RLS.
create or replace function public.tg_notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing   uuid;
  v_actor_name text;
begin
  select id into v_existing
    from public.notifications
   where recipient_id = new.recipient_id
     and type = 'message'
     and actor_id = new.sender_id
     and read_at is null
   order by created_at desc
   limit 1;

  if v_existing is not null then
    update public.notifications set created_at = now() where id = v_existing;
    return new;
  end if;

  select full_name into v_actor_name from public.profiles where id = new.sender_id;
  perform public.emit_notification(
    new.recipient_id,
    'message',
    new.sender_id,
    jsonb_build_object('actor_name', v_actor_name),
    'chat',
    new.sender_id  -- deep-link: open the chat with the sender
  );
  return new;
end;
$$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify
  after insert on public.messages
  for each row execute function public.tg_notify_on_message();

-- ── Trigger: coach comment on a body-metric reading → notify the athlete ──────
create or replace function public.tg_notify_on_metric_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner      uuid;
  v_actor_name text;
begin
  select user_id into v_owner from public.body_metrics where id = new.metric_id;
  if v_owner is null or v_owner = new.author_id then
    return new;  -- no owner, or the author IS the owner (shouldn't happen) — skip
  end if;

  select full_name into v_actor_name from public.profiles where id = new.author_id;
  perform public.emit_notification(
    v_owner,
    'coach_comment',
    new.author_id,
    jsonb_build_object('actor_name', v_actor_name),
    'body_metric',
    new.metric_id
  );
  return new;
end;
$$;

drop trigger if exists body_metric_comments_notify on public.body_metric_comments;
create trigger body_metric_comments_notify
  after insert on public.body_metric_comments
  for each row execute function public.tg_notify_on_metric_comment();

-- ── Trigger: a plan becomes published → notify the assigned client ────────────
-- Fires only on the draft/archived → published transition (insert-as-published or
-- update into published), and only for an ASSIGNED plan (templates have null client).
create or replace function public.tg_notify_on_plan_publish()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
begin
  if new.status <> 'published' then
    return new;
  end if;
  if new.client_id is null then
    return new;  -- a template, not an assignment
  end if;
  if tg_op = 'UPDATE' and old.status = 'published' then
    return new;  -- already published — a later edit isn't a new "published" event
  end if;

  select full_name into v_actor_name from public.profiles where id = new.coach_id;
  perform public.emit_notification(
    new.client_id,
    'plan_published',
    new.coach_id,
    jsonb_build_object('actor_name', v_actor_name, 'plan_title', new.title, 'plan_type', new.type::text),
    'plan',
    new.id
  );
  return new;
end;
$$;

drop trigger if exists plans_notify on public.plans;
create trigger plans_notify
  after insert or update on public.plans
  for each row execute function public.tg_notify_on_plan_publish();

-- ── Trigger: a completed set beats a prior best → notify the athlete (PR) ─────
-- e1RM (Epley, integer grams) for loaded movements; best reps for unloaded/bodyweight.
-- A PR requires a PRIOR record to beat — the first-ever log of a movement is a
-- baseline, not a PR. Guarded so an unrelated edit (e.g. a note) can't re-fire it.
create or replace function public.tg_notify_on_pr()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid;
  v_new_e1rm   bigint;
  v_prior_e1rm bigint;
  v_prior_reps integer;
begin
  if not new.is_completed then
    return new;
  end if;
  -- On an edit that didn't change the PR-relevant fields, don't re-evaluate.
  if tg_op = 'UPDATE'
     and old.is_completed
     and old.load_grams is not distinct from new.load_grams
     and old.reps_done  is not distinct from new.reps_done then
    return new;
  end if;

  select user_id into v_user from public.workout_sessions where id = new.session_id;
  if v_user is null then
    return new;
  end if;

  if coalesce(new.load_grams, 0) > 0 then
    v_new_e1rm := round(new.load_grams * (30 + coalesce(new.reps_done, 1)) / 30.0);
    select max(round(l.load_grams * (30 + coalesce(l.reps_done, 1)) / 30.0))::bigint
      into v_prior_e1rm
      from public.exercise_set_logs l
      join public.workout_sessions s on s.id = l.session_id
     where s.user_id = v_user
       and l.exercise_name = new.exercise_name
       and l.is_completed
       and coalesce(l.load_grams, 0) > 0
       and l.id <> new.id;
    if v_prior_e1rm is not null and v_new_e1rm > v_prior_e1rm then
      perform public.emit_notification(
        v_user, 'pr_achieved', v_user,
        jsonb_build_object('exercise_name', new.exercise_name, 'metric', 'e1rm', 'e1rm_grams', v_new_e1rm),
        'progress', null
      );
    end if;
  elsif coalesce(new.reps_done, 0) > 0 then
    select max(l.reps_done) into v_prior_reps
      from public.exercise_set_logs l
      join public.workout_sessions s on s.id = l.session_id
     where s.user_id = v_user
       and l.exercise_name = new.exercise_name
       and l.is_completed
       and coalesce(l.load_grams, 0) = 0
       and l.id <> new.id;
    if v_prior_reps is not null and new.reps_done > v_prior_reps then
      perform public.emit_notification(
        v_user, 'pr_achieved', v_user,
        jsonb_build_object('exercise_name', new.exercise_name, 'metric', 'reps', 'reps', new.reps_done),
        'progress', null
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists exercise_set_logs_notify on public.exercise_set_logs;
create trigger exercise_set_logs_notify
  after insert or update on public.exercise_set_logs
  for each row execute function public.tg_notify_on_pr();

-- ── Mark-read RPCs (the column-restricted UPDATE path) ────────────────────────
-- SECURITY DEFINER but hard-scoped to recipient_id = auth.uid(), so a caller can only
-- flip their OWN rows' read_at — never another user's, and never any other column.
create or replace function public.mark_notification_read(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set read_at = now()
   where id = p_id and recipient_id = auth.uid() and read_at is null;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications
     set read_at = now()
   where recipient_id = auth.uid() and read_at is null;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_all_notifications_read() from public;
revoke execute on function public.mark_notification_read(uuid) from anon;
revoke execute on function public.mark_all_notifications_read() from anon;
grant execute on function public.mark_notification_read(uuid) to authenticated, service_role;
grant execute on function public.mark_all_notifications_read() to authenticated, service_role;

-- ── Realtime ──────────────────────────────────────────────────────────────────
-- Add to Supabase's realtime publication so the badge/feed update live; Realtime
-- enforces the SELECT policy, so each user only receives their own rows. Guarded:
-- the publication exists on real Supabase but NOT in the local/CI shim (no-op there).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end
$$;
