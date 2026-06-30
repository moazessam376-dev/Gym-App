-- 0084_transformation_submissions.sql
--
-- Client-initiated before/after submissions (the athlete side of the E3 showcase).
-- A client builds a before/after card in their Progress section and SENDS it to their
-- coach. The coach reviews PENDING submissions in their Transformations editor and
-- APPROVES one to feature on their public showcase (coach_transformations, 0077), or
-- DISMISSES it. Nothing a client submits goes public without the coach's approval.
--
-- Privacy model (founder-confirmed): a submission is the client's explicit request to be
-- featured by THEIR coach. Approval is coach-curated (the coach owns their public page).
-- The public showcase RPC (get_coach_transformations, 0077) still gates on
-- athlete_profile.allow_transformation_sharing — set when the client submits — so revoking
-- consent hides everything instantly (existing behavior). The before/after photos use the
-- consent-tied `transformation` media kind (0078); the raw progress_photo read path is
-- never widened.
--
-- Ships the table WITH deny-by-default RLS (§2). Idempotent.

create table if not exists public.transformation_submissions (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.profiles (id) on delete cascade,
  coach_id        uuid not null references public.profiles (id) on delete cascade,
  caption         text check (caption is null or char_length(caption) <= 200),
  before_media_id uuid references public.media (id) on delete set null,
  after_media_id  uuid references public.media (id) on delete set null,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'dismissed')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists transformation_submissions_coach_idx
  on public.transformation_submissions (coach_id, status, created_at desc);
create index if not exists transformation_submissions_client_idx
  on public.transformation_submissions (client_id, created_at desc);

drop trigger if exists transformation_submissions_set_updated_at on public.transformation_submissions;
create trigger transformation_submissions_set_updated_at
  before update on public.transformation_submissions
  for each row execute function public.set_updated_at();

alter table public.transformation_submissions enable row level security;

-- Read: the client sees their own submissions; the coach sees ones addressed to them.
drop policy if exists transformation_submissions_select on public.transformation_submissions;
create policy transformation_submissions_select on public.transformation_submissions
  for select to authenticated
  using (client_id = auth.uid() or coach_id = auth.uid());

-- Insert: a client submits for THEMSELVES, addressed to THEIR coach, as pending only.
drop policy if exists transformation_submissions_insert on public.transformation_submissions;
create policy transformation_submissions_insert on public.transformation_submissions
  for insert to authenticated
  with check (client_id = auth.uid() and coach_id = public.my_coach_id() and status = 'pending');

-- Update: the client may edit / withdraw their OWN submission (e.g. swap a photo before
-- the coach acts). The status transition to approved/dismissed is the coach's RPC below,
-- which runs as the definer — clients never approve their own card.
drop policy if exists transformation_submissions_update on public.transformation_submissions;
create policy transformation_submissions_update on public.transformation_submissions
  for update to authenticated
  using (client_id = auth.uid())
  with check (client_id = auth.uid());

-- Delete: the client may remove their own submission.
drop policy if exists transformation_submissions_delete on public.transformation_submissions;
create policy transformation_submissions_delete on public.transformation_submissions
  for delete to authenticated
  using (client_id = auth.uid());

grant select, insert, update, delete on public.transformation_submissions to authenticated;
grant select on public.transformation_submissions to anon; -- anon: RLS -> 0 rows

-- ── Coach approve / dismiss (SECURITY DEFINER, atomic) ───────────────────────
-- Approve → upsert the featured coach_transformations row (one per coach+client) AND flip
-- the submission to 'approved', in one transaction. Dismiss → mark 'dismissed'. Fenced on
-- coach_id = auth.uid(): a coach can only resolve submissions addressed to them. auth.uid()
-- survives SECURITY DEFINER (read from the request JWT), so the fence holds.
create or replace function public.resolve_transformation_submission(p_submission uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.transformation_submissions%rowtype;
begin
  if p_action not in ('approve', 'dismiss') then
    raise exception 'invalid_action' using errcode = 'P0001';
  end if;
  select * into s from public.transformation_submissions where id = p_submission;
  if not found or s.coach_id <> auth.uid() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_action = 'approve' then
    insert into public.coach_transformations
      (coach_id, client_id, caption, before_media_id, after_media_id, featured_at)
    values (s.coach_id, s.client_id, s.caption, s.before_media_id, s.after_media_id, now())
    on conflict (coach_id, client_id) do update
      set caption         = excluded.caption,
          before_media_id = excluded.before_media_id,
          after_media_id  = excluded.after_media_id,
          featured_at     = now();
    update public.transformation_submissions set status = 'approved' where id = p_submission;
  else
    update public.transformation_submissions set status = 'dismissed' where id = p_submission;
  end if;
end;
$$;
-- Fresh public function → strip the default PUBLIC + by-name anon EXECUTE grants
-- (advisor 0028); authenticated keeps it (it's an action RPC, fenced in-function — the
-- accepted advisor 0029).
revoke all on function public.resolve_transformation_submission(uuid, text) from public, anon;
grant execute on function public.resolve_transformation_submission(uuid, text) to authenticated, service_role;
