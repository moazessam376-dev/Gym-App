-- 0002_progress_entries.sql
--
-- A client-owned child table. It exists in Phase 0 to PROVE tenant isolation:
-- a coach reaches a client's rows only via `coach_id`, and cross-tenant reads
-- return zero rows. RLS ships with the table (§2). No money columns here — when
-- money does arrive it is integer minor units + currency (see .claude/rules/money.md).

create table public.progress_entries (
  id            uuid primary key default gen_random_uuid(),
  -- The owner (a client). This is the `user_id = auth.uid()` column from §2.
  user_id       uuid not null references public.profiles (id) on delete cascade,
  recorded_at   timestamptz not null default now(),  -- UTC (§11)
  -- Integer units, never floats (same discipline as money's minor units).
  weight_grams  integer check (weight_grams is null or weight_grams > 0),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index progress_entries_user_id_idx on public.progress_entries (user_id);

alter table public.progress_entries enable row level security;

create trigger progress_entries_set_updated_at
  before update on public.progress_entries
  for each row execute function public.set_updated_at();

-- ── Policies (deny-by-default; explicit allows) ─────────────────────────────

-- Read: the owning client, their coach, or an admin.
create policy progress_entries_select on public.progress_entries
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_coach_of(user_id)
    or public.current_app_role() = 'admin'
  );

-- Create: only rows you OWN. The server never trusts a client-supplied owner.
create policy progress_entries_insert on public.progress_entries
  for insert to authenticated
  with check (user_id = auth.uid());

-- Update: the owner or their coach. The owner column cannot be changed to a user
-- you are not (no row-stealing), because the new value must still pass the check.
create policy progress_entries_update on public.progress_entries
  for update to authenticated
  using (user_id = auth.uid() or public.is_coach_of(user_id))
  with check (user_id = auth.uid() or public.is_coach_of(user_id));

-- Delete: the owner only.
create policy progress_entries_delete on public.progress_entries
  for delete to authenticated
  using (user_id = auth.uid());

grant select on public.progress_entries to anon, authenticated;   -- anon: RLS -> 0 rows
grant insert, update, delete on public.progress_entries to authenticated;
