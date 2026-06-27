-- 0056_workout_note_delete_keeps_chat.sql
--
-- Bug fix (notes-in-chat, 0051): an athlete deleting their own workout note got a
-- "bad request". Root cause — messages.workout_note_id is `on delete set null`
-- (0051), so deleting a note fires a CASCADE UPDATE on the mirrored chat message,
-- which runs the messages BEFORE-UPDATE trigger handle_message_update (0036/0037).
-- That trigger enforces the 15-minute soft-EDIT window: past the window it raises
-- `edit_window` (→ the 400 the founder saw); within it, it wrongly stamps `edited_at`
-- on a message the user never edited. Notes created BEFORE 0051 have no mirror row,
-- so no cascade fires and their delete works ("the 2 old ones").
--
-- Fix: a foreign-key SET NULL cascade is NOT a user edit. Re-assert the trigger
-- (full 0037 body reproduced) with a guard at the top that lets a pure
-- workout_note_id → null clear pass through untouched: no edit-window check, no
-- edited_at stamp. The chat copy survives, just unlinked from the deleted note.
-- (handle_message_insert is unchanged and not re-created here.)

create or replace function public.handle_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'service_role' then
    return new;  -- trusted server path
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser (RLS bypassed); not a client request
  end if;

  -- A foreign-key ON DELETE SET NULL cascade (the linked workout_note was deleted)
  -- clears workout_note_id ONLY — it is not a user edit. Let it through untouched so
  -- the chat copy survives (no edit-window check, no edited_at stamp).
  if old.workout_note_id is not null and new.workout_note_id is null
     and new.body         is not distinct from old.body
     and new.sender_id    is not distinct from old.sender_id
     and new.recipient_id is not distinct from old.recipient_id
     and new.reply_to_id  is not distinct from old.reply_to_id
     and new.media_id     is not distinct from old.media_id
     and new.created_at   is not distinct from old.created_at then
    return new;
  end if;

  -- Only the sender edits, and only the body — id/identity/threading/reply target/
  -- timestamps are fixed.
  if new.id           is distinct from old.id
     or new.sender_id    is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.reply_to_id  is distinct from old.reply_to_id
     or new.created_at   is distinct from old.created_at then
    raise exception 'message_immutable_fields' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid() and banned_at is not null) then
    raise exception 'banned' using errcode = 'P0001';
  end if;

  if old.created_at <= now() - interval '15 minutes' then
    raise exception 'edit_window' using errcode = 'P0001';
  end if;

  new.edited_at := now();
  new.original_body := coalesce(old.original_body, old.body);
  return new;
end;
$$;
