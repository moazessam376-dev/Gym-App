-- 0050_workout_note_notify.sql
-- Phase 17 follow-on (Slice F): an athlete's workout NOTE to their coach now fires an
-- in-app notification to the coach. Until now the note only surfaced passively in the
-- coach's "Recent feedback" card (discovered, never pushed). New notification type
-- `client_note` (coach is the recipient; the athlete is the actor). Distinct from the
-- existing `coach_comment` (coach → athlete on a body-metric reading).
--
-- Mirrors the 0032 backbone exactly: a SECURITY DEFINER AFTER-INSERT trigger on
-- workout_notes → emit_notification, which honors the recipient's per-type preference
-- (new column, default ON). No client INSERT path; rows are minted server-side only.
-- Idempotent.

-- 1. Allow the new type on the feed (recreate the column CHECK with the extra value).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('message', 'coach_comment', 'plan_published', 'pr_achieved', 'client_note'));

-- 2. Per-type preference column (default ON, like the others).
alter table public.notification_prefs
  add column if not exists client_note boolean not null default true;

-- 3. emit_notification — re-created to add the `client_note` pref branch. A CREATE OR
--    REPLACE replaces the WHOLE body, so every existing branch is kept verbatim
--    (migrations.md: recreating replaces the whole thing). Signature is unchanged.
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

-- 4. Trigger: athlete workout note → notify their coach.
-- workout_notes.user_id is the athlete (server-forced by the 0021 identity trigger).
-- The recipient is the athlete's coach (profiles.coach_id). Skip when there's no coach.
create or replace function public.tg_notify_on_workout_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coach      uuid;
  v_actor_name text;
begin
  select coach_id into v_coach from public.profiles where id = new.user_id;
  if v_coach is null or v_coach = new.user_id then
    return new;  -- unattached athlete (or somehow self) — nobody to notify
  end if;

  select full_name into v_actor_name from public.profiles where id = new.user_id;
  perform public.emit_notification(
    v_coach,
    'client_note',
    new.user_id,
    jsonb_build_object('actor_name', v_actor_name),
    'workout_note',
    new.id
  );
  return new;
end;
$$;

drop trigger if exists workout_notes_notify on public.workout_notes;
create trigger workout_notes_notify
  after insert on public.workout_notes
  for each row execute function public.tg_notify_on_workout_note();

-- 5. Lock the trigger fn out of the REST RPC surface (advisor 0029 — same as 0033). A
--    trigger fn errors if called as an RPC, but deny-by-default says shut the door.
--    Revoking EXECUTE does NOT stop the trigger from firing.
revoke all on function public.tg_notify_on_workout_note() from public;
revoke execute on function public.tg_notify_on_workout_note() from anon, authenticated;
