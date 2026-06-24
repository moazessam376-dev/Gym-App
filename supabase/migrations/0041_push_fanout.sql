-- 0041_push_fanout.sql
--
-- Phase 17 (Slice 2): bridge the in-app notification feed to native push. Every
-- notification is minted through ONE path (emit_notification, 0032), so a single
-- AFTER INSERT trigger on public.notifications fans every event type
-- (message / coach_comment / plan_published / pr_achieved) out to the service-role
-- `push-send` Edge Function — no per-event wiring. Per-type opt-outs are already
-- enforced before the row exists, so any inserted row is already opt-in. The
-- coalescing UPDATE in tg_notify_on_message (0032) is an UPDATE, not an INSERT, so
-- a chat burst does NOT re-fire push (one "new message" until read).
--
-- Secrets discipline (CLAUDE.md §3): the function URL + service-role key are read
-- from Supabase Vault at call time (`push_send_url`, `push_send_service_key`) —
-- NEVER hardcoded or committed. Set them once per project (see
-- docs/phases/phase-17-notifications.md). If either secret is missing the trigger
-- no-ops (the feed row is still created; push just doesn't fire) — fail-open for
-- delivery, never blocking the insert.
--
-- Harness-safe: pg_net + supabase_vault exist on Supabase but NOT in the local/CI
-- shim. Both the extension enable and the trigger creation are guarded by runtime
-- existence checks and built with EXECUTE, so this migration applies as a clean
-- no-op in the RLS harness (where check_function_bodies would otherwise reject a
-- body referencing net.* / vault.*). Idempotent.

-- ── Enable pg_net where the platform offers it (skipped in the plain-PG shim) ──
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net';
  end if;
end
$$;

-- ── The fan-out trigger — created only where pg_net + Vault are present ────────
do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net')
     and exists (select 1 from pg_extension where extname = 'supabase_vault') then

    execute $fn$
      create or replace function public.tg_push_on_notification()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      declare
        v_url text;
        v_key text;
      begin
        -- Vault holds the (non-secret) function URL and the (secret) service-role
        -- key. Read both; if either is unset, deliver nothing (the feed row stands).
        select decrypted_secret into v_url
          from vault.decrypted_secrets where name = 'push_send_url' limit 1;
        select decrypted_secret into v_key
          from vault.decrypted_secrets where name = 'push_send_service_key' limit 1;
        if v_url is null or v_key is null then
          return new;
        end if;

        -- pg_net queues the POST asynchronously, so the insert is never blocked.
        -- push-send authorizes by matching this bearer to the service-role key, so
        -- only this trusted server path can trigger a send (never an end user).
        perform net.http_post(
          url := v_url,
          body := jsonb_build_object('notification_id', new.id),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_key
          )
        );
        return new;
      end;
      $body$;
    $fn$;

    execute $tg$
      drop trigger if exists notifications_push on public.notifications;
      create trigger notifications_push
        after insert on public.notifications
        for each row execute function public.tg_push_on_notification();
    $tg$;

  end if;
end
$outer$;
