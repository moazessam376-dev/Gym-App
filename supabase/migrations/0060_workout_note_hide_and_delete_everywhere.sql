-- 0060_workout_note_hide_and_delete_everywhere.sql
--
-- Founder UX: an athlete deleting a workout note from the exercise tab must NOT
-- silently retract the copy mirrored into the coach chat (0051). The old single
-- "delete" dropped the workout_notes row, and the FK ON DELETE SET NULL (0051)
-- degraded the coach's chat note card to a plain bubble. Give the athlete two
-- explicit choices instead:
--
--   • Hide from my log  — the note stays everywhere it was sent (the chat note
--     card AND the coach's Notes tab); it's only removed from the athlete's own
--     exercise view via `hidden_at`. Done with a plain owner UPDATE — the
--     workout_notes owner UPDATE policy already exists (0021), and the BEFORE
--     trigger only re-stamps user_id = auth.uid(), so it passes through cleanly.
--
--   • Delete for everyone — the note row AND its mirrored chat message both go.
--     A client has no DELETE policy on `messages`, so this runs through a
--     SECURITY DEFINER RPC fenced to the caller's own rows. It deletes the mirror
--     message FIRST, then the note (deleting the note first would SET NULL the
--     mirror's workout_note_id, hiding it from the delete). There is no DELETE
--     trigger on messages, so the message delete is clean.

-- 1. Personal-hide flag — athlete's exercise view only; chat + coach Notes tab
--    are unaffected (they read messages / listClientNotes, not this column).
alter table public.workout_notes add column if not exists hidden_at timestamptz;

-- 2. Delete-for-everyone. auth.uid() survives SECURITY DEFINER (read from the JWT,
--    not the executing role), so the owner fence holds. Scoped to messages the
--    caller authored that mirror the caller's own note — no other row is reachable.
create or replace function public.delete_workout_note_everywhere(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Mirror message first (before the note delete would SET NULL its link).
  delete from public.messages
    where workout_note_id = p_id and sender_id = auth.uid();
  delete from public.workout_notes
    where id = p_id and user_id = auth.uid();
end;
$$;

-- A freshly-CREATEd function in public gets a default PUBLIC execute grant AND a
-- by-name anon grant (Supabase default privileges); a bare `revoke … from public`
-- does NOT remove the anon grant → advisor 0028. Revoke anon explicitly, then grant
-- only the signed-in / server roles.
revoke all on function public.delete_workout_note_everywhere(uuid) from public;
revoke execute on function public.delete_workout_note_everywhere(uuid) from anon;
grant execute on function public.delete_workout_note_everywhere(uuid) to authenticated, service_role;
