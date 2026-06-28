-- 0080_chat_note_context.sql
--
-- Engagement E6 — give the chat workout-note card its CONTEXT. 0051 mirrored a note into chat
-- with only the body + workout_note_id; the exercise/day/date came from a PostgREST embed that
-- realtime payloads don't carry, so a live note showed "body only until refetch". Denormalize
-- the context into real `messages` columns so it arrives in the realtime payload.
--
-- workout_notes has exercise_name + session_id, but NOT day/date — those live on the session,
-- so we join session_id → workout_sessions(day_id, session_date) → plan_days(name). Recreates
-- tg_notify_on_workout_note from the 0051 base (still the latest — 0063 only touched
-- handle_message_insert/update). Best-effort mirror insert preserved (wrapped so a blocked chat
-- copy never rolls back the note). Idempotent.

alter table public.messages
  add column if not exists workout_note_exercise text,
  add column if not exists workout_note_day      text,
  add column if not exists workout_note_date      date;

create or replace function public.tg_notify_on_workout_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coach      uuid;
  v_actor_name text;
  v_day        text;
  v_date       date;
begin
  select coach_id into v_coach from public.profiles where id = new.user_id;
  if v_coach is null or v_coach = new.user_id then
    return new;
  end if;

  -- Resolve day name + session date from the session (the note row has neither).
  if new.session_id is not null then
    select pd.name, ws.session_date
      into v_day, v_date
    from public.workout_sessions ws
    left join public.plan_days pd on pd.id = ws.day_id
    where ws.id = new.session_id;
  end if;

  -- Mirror the note into chat WITH context (best-effort; sender_id set by the BEFORE trigger).
  begin
    insert into public.messages (recipient_id, body, workout_note_id, workout_note_exercise, workout_note_day, workout_note_date)
    values (v_coach, new.body, new.id, new.exercise_name, v_day, v_date);
  exception when others then
    null;
  end;

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

revoke all on function public.tg_notify_on_workout_note() from public;
revoke execute on function public.tg_notify_on_workout_note() from anon, authenticated;
