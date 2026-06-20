-- 0009_plans.sql
--
-- Phase 3: training & nutrition plans. A coach authors plans for their OWN
-- clients (is_coach_of); the assigned client reads only their non-draft plans
-- and can never write. Same deny-by-default tenancy as the rest of the app
-- (CLAUDE.md §2). RLS ships with the tables. Idempotent so it can be re-pasted
-- into the SQL editor.

-- ── Enums ─────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'plan_type') then
    create type public.plan_type as enum ('training', 'nutrition');
  end if;
  if not exists (select 1 from pg_type where typname = 'plan_status') then
    create type public.plan_status as enum ('draft', 'published', 'archived');
  end if;
end
$$;

-- ── plans ─────────────────────────────────────────────────────────────────────
create table if not exists public.plans (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references public.profiles (id) on delete cascade,
  client_id  uuid not null references public.profiles (id) on delete cascade,
  type       public.plan_type   not null,
  title      text not null,
  status     public.plan_status not null default 'draft',
  version    integer not null default 1,
  created_at timestamptz not null default now(),  -- UTC (§11)
  updated_at timestamptz not null default now(),
  constraint plans_coach_not_client check (coach_id <> client_id)
);

create index if not exists plans_coach_id_idx  on public.plans (coach_id);
create index if not exists plans_client_id_idx on public.plans (client_id);

alter table public.plans enable row level security;

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- Read: the authoring coach sees their plans; the assigned client sees only
-- non-draft plans (drafts stay private to the coach); admin sees all.
drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated
  using (
    coach_id = auth.uid()
    or (client_id = auth.uid() and status <> 'draft')
    or public.current_app_role() = 'admin'
  );

-- Create: a coach authors ONLY for their own client, as themselves.
drop policy if exists plans_insert on public.plans;
create policy plans_insert on public.plans
  for insert to authenticated
  with check (
    coach_id = auth.uid()
    and public.current_app_role() = 'coach'
    and public.is_coach_of(client_id)
  );

-- Update: the authoring coach only; can't reassign to a non-client of theirs,
-- and can't hand the plan to another coach (coach_id stays self).
drop policy if exists plans_update on public.plans;
create policy plans_update on public.plans
  for update to authenticated
  using (coach_id = auth.uid())
  with check (
    coach_id = auth.uid()
    and public.is_coach_of(client_id)
  );

-- Delete: the authoring coach or an admin. Clients never write.
drop policy if exists plans_delete on public.plans;
create policy plans_delete on public.plans
  for delete to authenticated
  using (
    coach_id = auth.uid()
    or public.current_app_role() = 'admin'
  );

grant select, insert, update, delete on public.plans to authenticated;
grant select on public.plans to anon;  -- RLS -> 0 rows for anon

-- ── plan_items ────────────────────────────────────────────────────────────────
create table if not exists public.plan_items (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans (id) on delete cascade,
  position   integer not null default 0,
  name       text not null,
  notes      text,
  -- Type-specific structured fields (sets/reps, macros, ...). Validated by Zod
  -- in the app/Edge layer before write; kept as ints, never floats, inside.
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plan_items_plan_id_idx on public.plan_items (plan_id);

alter table public.plan_items enable row level security;

create trigger plan_items_set_updated_at
  before update on public.plan_items
  for each row execute function public.set_updated_at();

-- Ownership of an item flows from its parent plan. SECURITY DEFINER helpers so
-- the plan_items policies don't re-enter plans' RLS (recursion), mirroring
-- is_coach_of: pinned search_path, schema-qualified, granted narrowly.
create or replace function public.can_read_plan(p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.plans p
    where p.id = p_plan
      and (
        p.coach_id = auth.uid()
        or (p.client_id = auth.uid() and p.status <> 'draft')
        or public.current_app_role() = 'admin'
      )
  )
$$;

create or replace function public.can_write_plan(p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.plans p
    where p.id = p_plan
      and p.coach_id = auth.uid()
  )
$$;

revoke all on function public.can_read_plan(uuid)  from public;
revoke all on function public.can_write_plan(uuid) from public;
-- Internal RLS helpers — not client RPCs. Supabase default-grants EXECUTE to
-- anon too, so revoke it explicitly (anon's auth.uid() is null anyway).
revoke execute on function public.can_read_plan(uuid)  from anon;
revoke execute on function public.can_write_plan(uuid) from anon;
grant execute on function public.can_read_plan(uuid)  to authenticated, service_role;
grant execute on function public.can_write_plan(uuid) to authenticated, service_role;

-- Read items you can read the parent plan; write items only on plans you own.
drop policy if exists plan_items_select on public.plan_items;
create policy plan_items_select on public.plan_items
  for select to authenticated
  using (public.can_read_plan(plan_id));

drop policy if exists plan_items_insert on public.plan_items;
create policy plan_items_insert on public.plan_items
  for insert to authenticated
  with check (public.can_write_plan(plan_id));

drop policy if exists plan_items_update on public.plan_items;
create policy plan_items_update on public.plan_items
  for update to authenticated
  using (public.can_write_plan(plan_id))
  with check (public.can_write_plan(plan_id));

drop policy if exists plan_items_delete on public.plan_items;
create policy plan_items_delete on public.plan_items
  for delete to authenticated
  using (public.can_write_plan(plan_id));

grant select, insert, update, delete on public.plan_items to authenticated;
grant select on public.plan_items to anon;  -- RLS -> 0 rows for anon
