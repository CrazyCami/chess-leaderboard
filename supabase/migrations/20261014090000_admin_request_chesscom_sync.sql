-- Let signed-in league admins trigger the Chess.com import from the review
-- page. The dispatch itself reuses private.dispatch_chesscom_sync, so the
-- GitHub token never leaves Supabase Vault. Requests are logged and limited to
-- one per minute across all admins.

create table if not exists private.chesscom_sync_requests (
  id bigint generated always as identity primary key,
  requested_by uuid not null,
  requested_at timestamptz not null default pg_catalog.now(),
  full_backfill boolean not null,
  net_request_id bigint
);

revoke all on table private.chesscom_sync_requests from public, anon, authenticated;

create or replace function public.request_chesscom_sync(p_full_backfill boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_last timestamptz;
  v_net_request_id bigint;
begin
  if not public.is_league_admin() then
    raise exception 'Only league admins can request a Chess.com sync.' using errcode = '42501';
  end if;

  lock table private.chesscom_sync_requests in share row exclusive mode;

  select pg_catalog.max(requested_at)
    into v_last
    from private.chesscom_sync_requests;

  if v_last is not null and v_last > v_now - interval '60 seconds' then
    raise exception 'A sync was requested less than a minute ago. Wait a moment and try again.'
      using errcode = '55P03';
  end if;

  v_net_request_id := private.dispatch_chesscom_sync(p_full_backfill);

  insert into private.chesscom_sync_requests (requested_by, requested_at, full_backfill, net_request_id)
  values (auth.uid(), v_now, p_full_backfill, v_net_request_id);

  return pg_catalog.jsonb_build_object(
    'requested_at', v_now,
    'full_backfill', p_full_backfill
  );
end;
$$;

revoke all on function public.request_chesscom_sync(boolean) from public, anon;
grant execute on function public.request_chesscom_sync(boolean) to authenticated;
