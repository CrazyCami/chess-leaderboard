-- Restore standard Elo with K=50 after the v2 formula
-- migration. Keep prior replay rows and their v2 setting snapshots immutable.

update public.league_settings
   set k_factor = 50,
       formula_version = 'standard-elo-v1',
       updated_at = pg_catalog.now()
 where singleton;

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

revoke all on function private.rebuild_league_ratings(uuid, text)
  from public, anon, authenticated;

-- These settings applied only to Elo v2. The immutable replay columns remain
-- so earlier v2 rating_replays keep their complete audit settings.
alter table public.league_settings
  drop column if exists underdog_k_factor,
  drop column if exists rating_difference_sensitivity,
  drop column if exists draw_k_factor;

-- Publish standard Elo immediately for all existing approved eligible games.
select private.rebuild_league_ratings(
  null,
  'Restore standard-elo-v1 with K-factor 50'
);
