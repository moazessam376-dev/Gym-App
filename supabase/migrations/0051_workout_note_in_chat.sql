-- 0051_workout_note_in_chat.sql
-- Consolidate communication: an athlete's workout note now also appears INSIDE the
-- client↔coach chat as a distinct "note" card (kept alongside the F4 Notes tab + the
-- F5 client_note notification, per the founder's choice). Reuses the voice-note
-- precedent (0043): a message carries an extra nullable FK; the client renders it
-- specially. No message-kind enum exists, so we add `workout_note_id`.
--
-- The note→chat mirror is done SERVER-SIDE inside the existing workout-note trigger
-- (which already resolves the coach), as a best-effort insert: if the chat message is
-- blocked by handle_message_insert (the athlete is send-banned or rate-limited), the
-- note still saves — we swallow the error. sender_id is set to auth.uid() by the
-- message BEFORE trigger, exactly like a normal send.

-- 1. The link column (nullable; SET NULL so deleting a note doesn't delete the message).
alter table public.messages
  add column if not exists workout_note_id uuid references public.workout_notes (id) on delete set null;

create index if not exists messages_workout_note_idx on public.messages (workout_note_id);

-- 2. Re-create the workout-note trigger fn: keep the client_note notification AND
--    mirror the note into the chat. (CREATE OR REPLACE keeps the 0050 EXECUTE revokes,
--    re-asserted below to be safe.)
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
    return new;  -- unattached athlete (or somehow self) — nobody to notify/message
  end if;

  -- Mirror the note into the chat as a note-card message (best-effort). The message
  -- BEFORE trigger sets sender_id = auth.uid() (the athlete). If it's blocked (ban /
  -- rate limit), the note still saves.
  begin
    insert into public.messages (recipient_id, body, workout_note_id)
    values (v_coach, new.body, new.id);
  exception when others then
    null;
  end;

  -- Keep the dedicated client_note notification (F5).
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
