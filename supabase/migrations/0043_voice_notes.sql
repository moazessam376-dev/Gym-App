-- 0043_voice_notes.sql
--
-- Phase 18 (chat voice notes). Adds an `audio` media kind so a chat message can
-- carry a recorded voice note, reusing the EXACT secure media pipeline as photos
-- (signed inbox upload → magic-byte validation in media-finalize → service-role row
-- insert; bytes in a private bucket, served only via short-lived signed URLs, §7).
-- Ships every change WITH its RLS in the same migration (CLAUDE.md §2). Idempotent.
--
-- Read access is the one new wrinkle: a voice note's `media` row is owned by the
-- SENDER, but the RECIPIENT must read it too — and the existing media policy only
-- grants the owner, the owner's coach, or an admin. For a COACH→CLIENT note the
-- client is neither, so we add a participant path: anyone who is the sender or
-- recipient of a message that references the media row may read it. The check goes
-- through a SECURITY DEFINER helper so the policy doesn't re-enter messages' RLS
-- (same discipline as is_coach_of / can_read_*).

-- ── 1. `audio` media kind ────────────────────────────────────────────────────
-- ADD VALUE is safe inside the migration's implicit transaction on PG12+ as long as
-- the new value is not USED in the same transaction — and nothing below references
-- 'audio' as a literal (the kind is only written at runtime by media-finalize).
alter type public.media_kind add value if not exists 'audio';

-- ── 2. Allow audio MIME types on the media gatekeeper ────────────────────────
-- expo-audio records AAC in an MP4 container (.m4a → audio/mp4) on both platforms;
-- mp3/wav are accepted defensively. The real type is still decided by magic bytes
-- in media-finalize — this just widens the stored-value allowlist.
alter table public.media drop constraint if exists media_mime_type_check;
alter table public.media add constraint media_mime_type_check
  check (mime_type in (
    'image/jpeg', 'image/png', 'application/pdf',
    'audio/mp4', 'audio/mpeg', 'audio/wav'
  ));

-- ── 3. Attach media to a message + allow a body-less (voice-only) message ─────
alter table public.messages
  add column if not exists media_id uuid references public.media (id) on delete set null;

-- A text message still needs a body; a voice note may have an EMPTY body as long as
-- it carries media. (body stays NOT NULL — voice-only sends '' — to keep the column
-- shape simple and the existing realtime/edit paths unchanged.)
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check (
    char_length(body) <= 4000
    and (char_length(body) >= 1 or media_id is not null)
  );

-- ── 4. Let a chat participant read the message's media (both directions) ──────
-- SECURITY DEFINER + pinned search_path so the media SELECT policy can ask "is the
-- caller a party to a message that references this media?" without re-entering the
-- messages RLS (which would recurse). STABLE; schema-qualified.
create or replace function public.is_message_media_participant(p_media uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
      from public.messages m
     where m.media_id = p_media
       and (m.sender_id = auth.uid() or m.recipient_id = auth.uid())
  );
$$;

revoke all on function public.is_message_media_participant(uuid) from public;
revoke execute on function public.is_message_media_participant(uuid) from anon;
grant execute on function public.is_message_media_participant(uuid) to authenticated, service_role;

-- Re-create the media read policy with the participant path appended. (Owner / the
-- owner's coach / admin remain; voice-note recipients are the new addition.)
drop policy if exists media_select on public.media;
create policy media_select on public.media
  for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_coach_of(owner_id)
    or public.current_app_role() = 'admin'
    or public.is_message_media_participant(id)
  );
