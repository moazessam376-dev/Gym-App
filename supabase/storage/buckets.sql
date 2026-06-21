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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('media-inbox', 'media-inbox', false, 10485760,
   array['image/jpeg', 'image/png', 'application/pdf']),
  ('media', 'media', false, 10485760,
   array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
