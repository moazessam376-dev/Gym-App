-- supabase/storage/buckets.sql
--
-- Phase 4 storage buckets (CLAUDE.md §7). Applied to the live project VIA MCP /
-- the dashboard — NOT through the RLS harness migration runner, because the
-- plain-Postgres test shim has no `storage` schema. Kept here only to document &
-- reproduce the setup. Idempotent.
--
-- Both buckets are PRIVATE and LOCKED: there are deliberately NO storage.objects
-- policies, so neither `anon` nor `authenticated` can read/write objects directly.
-- The ONLY path for bytes is a service-role-minted signed URL issued by the
-- media-* Edge Functions. The security boundary is the public.media table's RLS
-- (which the harness DOES test), not storage policies.
--
--   media-inbox : raw, UNSANITIZED uploads (quarantine). Write via signed upload
--                 URL (media-create-upload); read+deleted only by media-finalize.
--   media       : sanitized, servable objects. Read via short-lived signed URL
--                 (media-signed-url). Written only by media-finalize.

-- NOTE (M-4): the audio/* types are required by voice notes (0043 added them to the
-- public.media table CHECK but NOT here) — without them the live buckets reject every
-- voice-note upload at the storage layer. RE-APPLY this file via MCP/dashboard after any
-- change; it is not run by the migration harness.
-- NOTE (E7): audio/webm + audio/ogg added for WEB voice notes (MediaRecorder records webm/opus).
-- Re-apply this file via MCP/dashboard so the live buckets accept them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media-inbox', 'media-inbox', false, 10485760,
   array['image/jpeg', 'image/png', 'application/pdf', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg']),
  ('media', 'media', false, 10485760,
   array['image/jpeg', 'image/png', 'application/pdf', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/ogg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
