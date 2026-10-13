create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function private.dispatch_chesscom_sync(p_full_backfill boolean)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_request_id bigint;
begin
  select secret.decrypted_secret
    into v_token
    from vault.decrypted_secrets as secret
   where secret.name = 'github_actions_dispatch_token';

  if v_token is null or pg_catalog.btrim(v_token) = '' then
    raise exception 'Supabase Vault secret github_actions_dispatch_token is required.';
  end if;

  select net.http_post(
    url := 'https://api.github.com/repos/CrazyCami/chess-leaderboard/actions/workflows/daily-chesscom-sync.yml/dispatches',
    headers := pg_catalog.jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || v_token,
      'Content-Type', 'application/json',
      'User-Agent', 'chess-leaderboard-supabase-scheduler',
      'X-GitHub-Api-Version', '2022-11-28'
    ),
    body := pg_catalog.jsonb_build_object(
      'ref', 'main',
      'inputs', pg_catalog.jsonb_build_object(
        'full_backfill', p_full_backfill::text
      )
    ),
    timeout_milliseconds := 10000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.dispatch_chesscom_sync(boolean)
  from public, anon, authenticated;

select cron.unschedule(jobid)
  from cron.job
 where jobname in ('chesscom-sync-recent', 'chesscom-sync-full-backfill');

select cron.schedule(
  'chesscom-sync-recent',
  '*/5 * * * *',
  $job$ select private.dispatch_chesscom_sync(false); $job$
);

select cron.schedule(
  'chesscom-sync-full-backfill',
  '18 2 * * *',
  $job$ select private.dispatch_chesscom_sync(true); $job$
);
