-- 0058_conversation_previews.sql
--
-- Slice "chat ⇄ clients differentiation": the Chat tab listed the same plain
-- avatar+name rows as the Clients tab (both fed by useMyClients) because there was
-- no last-message / unread aggregation and no chat read-state anywhere in the app.
-- This adds the missing backend, in one round-trip:
--   * conversation_read_state — a per-(user, peer) last_read_at marker (own rows only).
--   * mark_conversation_read(peer)  — upsert the marker (called when a thread opens).
--   * list_conversation_previews()  — one row per counterpart: the last message + a
--     recency timestamp + unread count + voice/note flags, for the chat list.
-- Read-state mirrors the notifications mark_*_read pattern (0032). The two preview
-- RPCs are field-allowlist SECURITY DEFINER reads fenced on auth.uid() (accepted
-- 0029 RPCs — the boundary is the in-function participant fence + the column list).

-- ── read-state: who has read up to when, per conversation (own rows only) ─────
create table if not exists public.conversation_read_state (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  peer_id      uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),  -- UTC (§11)
  primary key (user_id, peer_id)
);

alter table public.conversation_read_state enable row level security;

drop policy if exists conversation_read_state_select on public.conversation_read_state;
create policy conversation_read_state_select on public.conversation_read_state
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists conversation_read_state_insert on public.conversation_read_state;
create policy conversation_read_state_insert on public.conversation_read_state
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists conversation_read_state_update on public.conversation_read_state;
create policy conversation_read_state_update on public.conversation_read_state
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update on public.conversation_read_state to authenticated;

-- ── mark a conversation read (upsert the caller's own marker) ─────────────────
create or replace function public.mark_conversation_read(p_peer uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.conversation_read_state (user_id, peer_id, last_read_at)
  values (auth.uid(), p_peer, now())
  on conflict (user_id, peer_id) do update set last_read_at = now();
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- ── the chat list: last message + unread count per counterpart ────────────────
-- SECURITY DEFINER + an explicit participant fence (only conversations the caller is
-- a party to) + a hand-picked column list (peer name/avatar only — never other
-- profile fields). Recency-sorted for the "list of conversations" feel.
create or replace function public.list_conversation_previews()
returns table(
  peer_id         uuid,
  full_name       text,
  avatar_media_id uuid,
  last_body       text,
  last_at         timestamptz,
  last_from_me    boolean,
  is_voice        boolean,
  is_note         boolean,
  unread_count    integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with my as (select auth.uid() as uid),
  -- the most recent message per counterpart (the OTHER party of each of my messages)
  last_msg as (
    select distinct on (m.peer)
      m.peer, m.body, m.created_at, m.sender_id, m.media_id, m.workout_note_id
    from (
      select
        case when sender_id = (select uid from my) then recipient_id else sender_id end as peer,
        body, created_at, sender_id, media_id, workout_note_id
      from public.messages
      where sender_id = (select uid from my) or recipient_id = (select uid from my)
    ) m
    order by m.peer, m.created_at desc
  )
  select
    lm.peer as peer_id,
    p.full_name,
    p.avatar_media_id,
    lm.body as last_body,
    lm.created_at as last_at,
    (lm.sender_id = (select uid from my)) as last_from_me,
    (md.kind = 'audio') as is_voice,
    (lm.workout_note_id is not null) as is_note,
    (
      select count(*)::int
      from public.messages um
      where um.recipient_id = (select uid from my)
        and um.sender_id = lm.peer
        and um.created_at > coalesce(rs.last_read_at, '-infinity'::timestamptz)
    ) as unread_count
  from last_msg lm
  join public.profiles p on p.id = lm.peer
  left join public.media md on md.id = lm.media_id
  left join public.conversation_read_state rs
    on rs.user_id = (select uid from my) and rs.peer_id = lm.peer
  order by lm.created_at desc;
$$;

revoke all on function public.list_conversation_previews() from public;
grant execute on function public.list_conversation_previews() to authenticated, service_role;
