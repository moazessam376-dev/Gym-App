-- 0078_transformation_media_kind.sql
--
-- Engagement E3 — a dedicated `transformation` media kind for the public coach showcase.
-- Critical privacy rule (§7, rls.md): NEVER widen the raw progress_photo read path. Instead,
-- transformation photos are a separate kind whose public readability is TIED TO ACTIVE CONSENT:
-- a transformation image is readable by any authenticated viewer ONLY while it is referenced by
-- a coach_transformations row whose client still has allow_transformation_sharing = true AND the
-- coach is public. Revoke consent / un-feature → the bytes stop being publicly readable.
--
-- Recreates the WHOLE media_select policy, preserving EVERY prior branch (owner/coach/admin 0013,
-- voice-note participant 0043, public avatar 0044) and adding the transformation branch. Uses
-- `kind::text = 'transformation'` so the value just ADDED to the enum can be referenced in the
-- same migration (Postgres forbids a new enum literal in the same tx; a text compare is safe —
-- same pattern as 0044's avatar branch). Depends on 0077 (coach_transformations). Idempotent.

alter type public.media_kind add value if not exists 'transformation';

drop policy if exists media_select on public.media;
create policy media_select on public.media
  for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_coach_of(owner_id)
    or public.current_app_role() = 'admin'
    or public.is_message_media_participant(id)                         -- 0043 voice-note recipient
    or (kind::text = 'avatar' and public.is_public_profile(owner_id))  -- 0044 public avatar
    or (kind::text = 'transformation' and exists (                     -- 0078 consented showcase
      select 1
      from public.coach_transformations ct
      join public.athlete_profile ap on ap.user_id = ct.client_id
      where (ct.before_media_id = media.id or ct.after_media_id = media.id)
        and ap.allow_transformation_sharing
        and public.is_public_profile(ct.coach_id)
    ))
  );
