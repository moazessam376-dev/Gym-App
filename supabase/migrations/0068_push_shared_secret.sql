-- 0068_push_shared_secret.sql
--
-- Security H-2 (push authorization brittleness). push-send authorized only on the JWT
-- `role` claim, trusting the gateway's verify_jwt — if verify_jwt were ever misconfigured
-- off, a forged service_role JWT could fan out push to anyone. Add a SECOND factor
-- independent of verify_jwt: a Vault-stored shared secret (`push_shared_secret`) that this
-- trigger sends as the `x-push-secret` header; push-send byte-compares it to its
-- PUSH_SHARED_SECRET env. Recreates tg_push_on_notification (full 0041 body reproduced)
-- with the header added — sent only when the secret is set, so it stays backward-compatible
-- until both ends are configured (push is not live yet). Guarded + harness-safe exactly
-- like 0041 (pg_net + supabase_vault only). Idempotent.
--
-- Activation (with push, your action): set Vault `push_shared_secret` AND the push-send
-- env `PUSH_SHARED_SECRET` to the same value; keep verify_jwt=true (supabase/config.toml).

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
        v_url    text;
        v_key    text;
        v_secret text;
      begin
        -- Vault holds the (non-secret) function URL, the (secret) service-role key, and
        -- the (secret) shared second factor. Read all three; if URL/key are unset,
        -- deliver nothing (the feed row stands).
        select decrypted_secret into v_url
          from vault.decrypted_secrets where name = 'push_send_url' limit 1;
        select decrypted_secret into v_key
          from vault.decrypted_secrets where name = 'push_send_service_key' limit 1;
        select decrypted_secret into v_secret
          from vault.decrypted_secrets where name = 'push_shared_secret' limit 1;
        if v_url is null or v_key is null then
          return new;
        end if;

        -- pg_net queues the POST asynchronously, so the insert is never blocked. push-send
        -- authorizes on the service-role bearer AND (when set) the x-push-secret header.
        perform net.http_post(
          url := v_url,
          body := jsonb_build_object('notification_id', new.id),
          headers := jsonb_strip_nulls(jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_key,
            'x-push-secret', v_secret
          ))
        );
        return new;
      end;
      $body$;
    $fn$;

    execute 'revoke execute on function public.tg_push_on_notification() from public, anon, authenticated';

  end if;
end
$outer$;
