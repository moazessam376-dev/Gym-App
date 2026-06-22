-- 0024_one_published_plan_per_type.sql
--
-- Business rule: a client may have at most ONE published plan per type (one
-- training + one nutrition) at a time. Publishing a new plan should SUPERSEDE the
-- previously published one of the same type — not stack a second live plan.
--
-- Enforced server-side with an AFTER trigger so it holds no matter which path
-- publishes (coach toggle, assign RPC, admin). The trigger archives sibling
-- published plans of the same (client_id, type); because it only acts when the new
-- status is 'published', the cascade it triggers on the archived rows is a no-op
-- (no infinite recursion). Idempotent.

create or replace function public.archive_superseded_plans()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and new.client_id is not null then
    update public.plans
       set status = 'archived'
     where client_id = new.client_id
       and type      = new.type
       and status    = 'published'
       and id <> new.id;
  end if;
  return null;  -- AFTER trigger: return value is ignored
end;
$$;

drop trigger if exists plans_archive_superseded on public.plans;
create trigger plans_archive_superseded
  after insert or update of status on public.plans
  for each row
  when (new.status = 'published' and new.client_id is not null)
  execute function public.archive_superseded_plans();

-- One-off cleanup of any client that already has >1 published plan of a type:
-- keep the most recently created published plan, archive the older ones.
with ranked as (
  select id,
         row_number() over (
           partition by client_id, type
           order by created_at desc, id desc
         ) as rn
  from public.plans
  where client_id is not null and status = 'published'
)
update public.plans p
   set status = 'archived'
  from ranked r
 where p.id = r.id and r.rn > 1;
