-- Retry-safe Chess.com sync storage and rating replay path.
-- Import credentials are held by the scheduled server job, never by the browser.

alter table public.import_runs
  add column sync_date date,
  add column pending_count integer not null default 0 check (pending_count >= 0);

create unique index import_runs_one_success_per_london_date
  on public.import_runs (sync_date)
  where sync_date is not null and status = 'succeeded';

create table public.import_conflicts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete restrict,
  observed_facts jsonb not null,
  first_seen_at timestamptz not null default now(),
  constraint import_conflict_observation_unique unique (game_id, observed_facts)
);
alter table public.import_conflicts enable row level security;
revoke all on public.import_conflicts from anon, authenticated;
grant select on public.import_conflicts to authenticated;
grant all on public.import_conflicts to service_role;
create policy import_conflicts_admin_read
  on public.import_conflicts for select to authenticated
  using ((select public.is_league_admin()));

create or replace function private.rebuild_league_ratings(
  p_created_by uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replay_id uuid;
  v_initial_rating numeric;
  v_k_factor numeric;
  v_formula_version text;
  v_player_ids text[] := array[]::text[];
  v_ratings numeric[] := array[]::numeric[];
  v_white_index integer;
  v_black_index integer;
  v_white_expected numeric;
  v_black_expected numeric;
  v_white_score numeric;
  v_black_score numeric;
  v_white_change numeric;
  v_black_change numeric;
  v_game record;
begin
  perform pg_catalog.pg_advisory_xact_lock(81273401, 1);

  select settings.initial_rating, settings.k_factor, settings.formula_version
    into v_initial_rating, v_k_factor, v_formula_version
    from public.league_settings as settings
   where settings.singleton;
  if not found then
    raise exception 'League settings are missing.' using errcode = 'P0002';
  end if;

  insert into public.rating_replays (
    created_by, reason, initial_rating, k_factor, formula_version
  ) values (
    p_created_by, p_reason, v_initial_rating, v_k_factor, v_formula_version
  ) returning id into v_replay_id;

  for v_game in
    select game.id, game.white_player_id, game.black_player_id,
           game.result, game.played_at
      from public.games as game
     where game.review_status = 'approved'
       and game.result is not null
       and game.rules = 'chess'
       and game.time_control ~ '^[[:space:]]*0*600([+]0*)?[[:space:]]*$'
       and game.played_at >= timestamptz '2026-10-10 00:00:00 Europe/London'
       and game.white_player_id <> game.black_player_id
     order by game.played_at, game.id
  loop
    if not (v_game.white_player_id = any(v_player_ids)) then
      v_player_ids := pg_catalog.array_append(v_player_ids, v_game.white_player_id);
      v_ratings := pg_catalog.array_append(v_ratings, v_initial_rating);
    end if;
    if not (v_game.black_player_id = any(v_player_ids)) then
      v_player_ids := pg_catalog.array_append(v_player_ids, v_game.black_player_id);
      v_ratings := pg_catalog.array_append(v_ratings, v_initial_rating);
    end if;

    v_white_index := pg_catalog.array_position(v_player_ids, v_game.white_player_id);
    v_black_index := pg_catalog.array_position(v_player_ids, v_game.black_player_id);
    v_white_expected := 1 / (1 + pg_catalog.power(10::numeric,
      (v_ratings[v_black_index] - v_ratings[v_white_index]) / 400));
    v_black_expected := 1 / (1 + pg_catalog.power(10::numeric,
      (v_ratings[v_white_index] - v_ratings[v_black_index]) / 400));

    case v_game.result
      when 'white_win' then v_white_score := 1; v_black_score := 0;
      when 'draw' then v_white_score := 0.5; v_black_score := 0.5;
      when 'black_win' then v_white_score := 0; v_black_score := 1;
    end case;
    v_white_change := v_k_factor * (v_white_score - v_white_expected);
    v_black_change := v_k_factor * (v_black_score - v_black_expected);

    insert into public.rating_events (
      replay_id, game_id, player_id, opponent_id, played_at, result,
      rating_before, rating_change, rating_after
    ) values
      (v_replay_id, v_game.id, v_game.white_player_id, v_game.black_player_id,
       v_game.played_at,
       case v_game.result
         when 'white_win' then 'win'::public.league_player_result
         when 'draw' then 'draw'::public.league_player_result
         when 'black_win' then 'loss'::public.league_player_result
       end,
       v_ratings[v_white_index], v_white_change,
       v_ratings[v_white_index] + v_white_change),
      (v_replay_id, v_game.id, v_game.black_player_id, v_game.white_player_id,
       v_game.played_at,
       case v_game.result
         when 'white_win' then 'loss'::public.league_player_result
         when 'draw' then 'draw'::public.league_player_result
         when 'black_win' then 'win'::public.league_player_result
       end,
       v_ratings[v_black_index], v_black_change,
       v_ratings[v_black_index] + v_black_change);

    v_ratings[v_white_index] := v_ratings[v_white_index] + v_white_change;
    v_ratings[v_black_index] := v_ratings[v_black_index] + v_black_change;
  end loop;

  return v_replay_id;
end;
$$;

create function private.import_chesscom_games_internal(
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
  if exists (
    select 1 from public.import_runs
     where sync_date = p_sync_date and status = 'succeeded'
  ) then
    return pg_catalog.jsonb_build_object(
      'already_done', true, 'inserted', 0, 'pending', 0,
      'conflicts', 0, 'replay_id', null
    );
  end if;

  insert into public.import_runs (trigger_name, sync_date, players_checked, games_seen)
  values ('github_actions_daily', p_sync_date, p_players_checked, p_games_seen)
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
      null, 'Daily Chess.com import for London date ' || p_sync_date::text
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

revoke all on function private.rebuild_league_ratings(uuid, text) from public, anon, authenticated;
revoke all on function private.import_chesscom_games_internal(date, integer, integer, jsonb)
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.import_chesscom_games_internal(date, integer, integer, jsonb)
  to service_role;

-- PostgREST exposes only this narrow server-role entry point; the underlying
-- privileged function remains in the non-exposed private schema.
create function public.import_chesscom_games(
  p_sync_date date,
  p_players_checked integer,
  p_games_seen integer,
  p_games jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.import_chesscom_games_internal(
    p_sync_date, p_players_checked, p_games_seen, p_games
  );
$$;
revoke all on function public.import_chesscom_games(date, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_chesscom_games(date, integer, integer, jsonb)
  to service_role;
