-- 0013_media.sql
--
-- Phase 4: secure media for sensitive health data — progress photos, InBody scans
-- (CLAUDE.md §7). `public.media` is the GATEKEEPER: a row exists only AFTER an Edge
-- Function (media-finalize) has validated magic bytes and STRIPPED EXIF, then
-- written the sanitized object to a private bucket. The client NEVER writes this
-- table directly — all writes are service-role-only (§2: ownership writes are
-- server-side only). Bytes live in PRIVATE, LOCKED storage buckets and are served
-- only via short-lived service-role signed URLs (§7); there are deliberately no
-- storage.objects policies (the security boundary is this table's RLS, which the
-- harness can test — the plain-Postgres shim has no `storage` schema).
--
-- Ownership/RLS mirrors progress_entries (0002): owner, their coach, or an admin
-- may read. Idempotent so it can be re-pasted into the SQL editor.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'media_kind') then
    create type public.media_kind as enum ('progress_photo', 'inbody', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'media_status') then
    -- Rows are inserted 'ready' (post-sanitization). The other states exist for
    -- future async pipelines (e.g. virus scan / async re-encode).
    create type public.media_status as enum ('ready', 'quarantined', 'failed');
  end if;
end
$$;

create table if not exists public.media (
  id                uuid primary key default gen_random_uuid(),
  -- The owner (a client). This is the `user_id = auth.uid()` column from §2.
  owner_id          uuid not null references public.profiles (id) on delete cascade,
  kind              public.media_kind not null,
  status            public.media_status not null default 'ready',
  -- Storage coordinates of the SANITIZED object (private bucket; signed-URL only).
  bucket            text not null,
  path              text not null,
  mime_type         text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes        integer not null check (size_bytes > 0 and size_bytes <= 10485760),  -- ≤ 10 MB (§7)
  -- Optional link to a weigh-in (many photos → one entry). FK lives here so the
  -- media table stays the generic gatekeeper; nothing is required to link.
  progress_entry_id uuid references public.progress_entries (id) on delete set null,
  created_at        timestamptz not null default now(),  -- UTC (§11)
  unique (bucket, path)
);

create index if not exists media_owner_created_idx on public.media (owner_id, created_at);

alter table public.media enable row level security;

-- ── Policies (deny-by-default; explicit allows) ─────────────────────────────
-- Read: the owning client, their coach, or an admin (same tenancy as progress).
drop policy if exists media_select on public.media;
create policy media_select on public.media
  for select to authenticated
  using (
    owner_id = auth.uid()
    or public.is_coach_of(owner_id)
    or public.current_app_role() = 'admin'
  );

-- No INSERT / UPDATE / DELETE policy on purpose: every write goes through the
-- media-finalize Edge Function as the service role (§2). Deny-by-default means an
-- authenticated client gets 0 rows / a permission error if it tries to write.

grant select on public.media to anon, authenticated;  -- anon: RLS -> 0 rows
-- No insert/update/delete grant to authenticated — the trusted server path owns writes.
