-- Allow repeated archive polls on one London date; game URL uniqueness keeps
-- subsequent polls idempotent while the per-date advisory lock serializes them.
drop index if exists public.import_runs_one_success_per_london_date;

create or replace function private.import_chesscom_games_internal(
  p_sync_date date,
  p_players_checked integer,
  p_games_seen integer,
  p_games jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_replay_id uuid;
  v_inserted integer := 0;
  v_approved_inserted integer := 0;
  v_pending integer := 0;
  v_conflicts integer := 0;
  v_row record;
  v_game_id uuid;
begin
  if p_sync_date is null or p_games is null or pg_catalog.jsonb_typeof(p_games) <> 'array' then
    raise exception 'Sync date and a games array are required.' using errcode = '22023';
  end if;
  if p_players_checked < 0 or p_games_seen < 0 then
    raise exception 'Import counts cannot be negative.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chesscom-sync:' || p_sync_date::text, 4711)
  );

  insert into public.import_runs (trigger_name, sync_date, players_checked, games_seen)
  values ('github_actions_scheduled_sync', p_sync_date, p_players_checked, p_games_seen)
  returning id into v_run_id;

  for v_row in
    select item.*
      from pg_catalog.jsonb_to_recordset(p_games) as item(
        source_game_url text,
        white_player_id text,
        black_player_id text,
        result public.league_game_result,
        white_source_result text,
        black_source_result text,
        played_at timestamptz,
        time_control text,
        rules text,
        review_status public.league_review_status
      )
  loop
    if v_row.source_game_url is null
       or v_row.source_game_url !~ '^https://(www\.)?chess\.com/'
       or v_row.white_player_id is null
       or v_row.black_player_id is null or v_row.played_at is null
       or v_row.time_control is null or v_row.rules is distinct from 'chess'
       or v_row.time_control !~ '^[[:space:]]*0*600([+]0*)?[[:space:]]*$'
       or v_row.played_at < timestamptz '2026-10-10 00:00:00 Europe/London'
       or v_row.review_status is null
       or v_row.review_status not in ('pending', 'approved')
       or v_row.white_player_id = v_row.black_player_id then
      raise exception 'Import contains an invalid game candidate.' using errcode = '22023';
    end if;
    if v_row.review_status = 'approved' and v_row.result is null then
      raise exception 'A result-less game cannot be auto-approved.' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.players player
       where player.id = v_row.white_player_id and player.is_active
    ) or not exists (
      select 1 from public.players player
       where player.id = v_row.black_player_id and player.is_active
    ) then
      raise exception 'Both game participants must be active registered players.' using errcode = '22023';
    end if;

    insert into public.games (
      source, source_game_url, white_player_id, black_player_id, result,
      white_source_result, black_source_result, played_at, time_control,
      rules, review_status
    ) values (
      'chess_com', v_row.source_game_url, v_row.white_player_id,
      v_row.black_player_id, v_row.result, v_row.white_source_result,
      v_row.black_source_result, v_row.played_at, v_row.time_control,
      v_row.rules, v_row.review_status
    ) on conflict (source_game_url)
      where source = 'chess_com' and source_game_url is not null do nothing
    returning id into v_game_id;

    if v_game_id is not null then
      v_inserted := v_inserted + 1;
      if v_row.review_status = 'pending' then v_pending := v_pending + 1; end if;
      if v_row.review_status = 'approved' then
        v_approved_inserted := v_approved_inserted + 1;
      end if;
    else
      select game.id into v_game_id
        from public.games as game
       where game.source = 'chess_com'
         and game.source_game_url = v_row.source_game_url;
      if exists (
        select 1 from public.games as game
         where game.id = v_game_id
           and (game.white_player_id is distinct from v_row.white_player_id
             or game.black_player_id is distinct from v_row.black_player_id
             or game.result is distinct from v_row.result
             or game.white_source_result is distinct from v_row.white_source_result
             or game.black_source_result is distinct from v_row.black_source_result
             or game.played_at is distinct from v_row.played_at
             or game.time_control is distinct from v_row.time_control
             or game.rules is distinct from v_row.rules)
      ) then
        insert into public.import_conflicts (game_id, observed_facts)
        values (v_game_id, pg_catalog.to_jsonb(v_row))
        on conflict (game_id, observed_facts) do nothing;
        v_conflicts := v_conflicts + 1;
      end if;
    end if;
    v_game_id := null;
  end loop;

  if v_approved_inserted > 0 and exists (
    select 1 from public.games
     where source = 'chess_com'
       and review_status = 'approved'
       and played_at >= timestamptz '2026-10-10 00:00:00 Europe/London'
  ) then
    v_replay_id := private.rebuild_league_ratings(
      null, 'Scheduled Chess.com import for London date ' || p_sync_date::text
    );
  end if;

  update public.import_runs
     set finished_at = pg_catalog.clock_timestamp(),
         status = 'succeeded', games_inserted = v_inserted,
         pending_count = v_pending
   where id = v_run_id;

  return pg_catalog.jsonb_build_object(
    'already_done', false, 'inserted', v_inserted, 'pending', v_pending,
    'conflicts', v_conflicts, 'replay_id', v_replay_id
  );
end;
$$;
