-- 0064_foodlog_rate_limit.sql
--
-- Security M-7 (food-diary flooding). handle_food_log_insert (0019) allowed 40 entries /
-- 10s (14,400/hr) — enough for sustained row-bloat spam. Tighten to 20 / 10s, still
-- generous for adding a multi-item meal in a burst. SECURITY INVOKER + pinned search_path
-- unchanged. Full body reproduced (migrations.md). Idempotent.

create or replace function public.handle_food_log_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_recent integer;
begin
  if current_user = 'service_role' then
    return new;  -- trusted server path
  end if;
  if auth.uid() is null then
    return new;  -- seed/superuser (RLS bypassed); not a client request
  end if;

  -- The server owns the owner identity (never trust a client value).
  new.user_id := auth.uid();

  -- Rate limit: at most 20 entries per rolling 10-second window per user (M-7).
  select count(*) into v_recent
    from public.food_log_entries
   where user_id = auth.uid()
     and created_at > now() - interval '10 seconds';
  if v_recent >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
