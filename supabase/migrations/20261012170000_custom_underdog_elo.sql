-- Version 2 league Elo settings and chronological replay.
-- Existing k_factor is retained as the normal K-factor for compatibility.

alter table public.league_settings
  add column if not exists underdog_k_factor numeric not null default 100 check (underdog_k_factor > 0),
  add column if not exists rating_difference_sensitivity numeric not null default 100
    check (rating_difference_sensitivity > 0),
  add column if not exists draw_k_factor numeric not null default 50 check (draw_k_factor > 0);

update public.league_settings
   set k_factor = 50,
       formula_version = 'underdog-sensitive-elo-v2',
       updated_at = pg_catalog.now()
 where singleton;

-- Null values on older replay rows mean that those rows predate this formula.
alter table public.rating_replays
  add column if not exists underdog_k_factor numeric check (underdog_k_factor > 0),
  add column if not exists rating_difference_sensitivity numeric check (rating_difference_sensitivity > 0),
  add column if not exists draw_k_factor numeric check (draw_k_factor > 0);

-- The helper's historical name remains for compatibility. Current league
-- rules count every approved game that otherwise meets rating eligibility.
create or replace function private.league_rating_games_within_pair_limit()
returns table (game_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select game.id as game_id
    from public.games as game
   where game.review_status = 'approved'
     and game.result is not null
     and game.rules = 'chess'
     and game.time_control ~ '^[[:space:]]*0*600([+]0*)?[[:space:]]*$'
     and game.played_at >= timestamptz '2026-10-10 00:00:00 Europe/London'
     and game.white_player_id <> game.black_player_id;
$$;
revoke all on function private.league_rating_games_within_pair_limit()
  from public, anon, authenticated;

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
  v_normal_k numeric;
  v_underdog_k numeric;
  v_sensitivity numeric;
  v_draw_k numeric;
  v_formula_version text;
  v_player_ids text[] := array[]::text[];
  v_ratings numeric[] := array[]::numeric[];
  v_white_index integer;
  v_black_index integer;
  v_white_expected numeric;
  v_white_score numeric;
  v_white_change numeric;
  v_black_change numeric;
  v_effective_k numeric;
  v_upset_strength numeric;
  v_underdog_win boolean;
  v_game record;
begin
  perform pg_catalog.pg_advisory_xact_lock(81273401, 1);

  select settings.initial_rating, settings.k_factor,
         settings.underdog_k_factor, settings.rating_difference_sensitivity,
         settings.draw_k_factor, settings.formula_version
    into v_initial_rating, v_normal_k, v_underdog_k, v_sensitivity,
         v_draw_k, v_formula_version
    from public.league_settings as settings
   where settings.singleton;
  if not found then
    raise exception 'League settings are missing.' using errcode = 'P0002';
  end if;

  insert into public.rating_replays (
    created_by, reason, initial_rating, k_factor, underdog_k_factor,
    rating_difference_sensitivity, draw_k_factor, formula_version
  ) values (
    p_created_by, p_reason, v_initial_rating, v_normal_k, v_underdog_k,
    v_sensitivity, v_draw_k, v_formula_version
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
       and game.id in (
         select eligible.game_id
           from private.league_rating_games_within_pair_limit() as eligible
       )
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

    case v_game.result
      when 'white_win' then v_white_score := 1;
      when 'draw' then v_white_score := 0.5;
      when 'black_win' then v_white_score := 0;
    end case;

    v_underdog_win :=
      (v_ratings[v_white_index] < v_ratings[v_black_index] and v_white_score = 1)
      or (v_ratings[v_white_index] > v_ratings[v_black_index] and v_white_score = 0);
    v_upset_strength := least(
      1::numeric,
      abs(v_ratings[v_black_index] - v_ratings[v_white_index]) / (4 * v_sensitivity)
    );
    v_effective_k := case when v_underdog_win
      then v_normal_k + (v_underdog_k - v_normal_k) * v_upset_strength
      else v_normal_k
    end;

    if v_white_score = 0.5 then
      v_white_change := v_draw_k * (v_white_score - v_white_expected);
    elsif v_underdog_win then
      v_white_change := v_effective_k * (v_white_score - v_white_expected);
    else
      v_white_change := v_normal_k * (v_white_score - v_white_expected) * 0.1;
    end if;
    -- Keep league rating points conserved exactly, including for draws.
    v_black_change := -v_white_change;

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

-- Publish the new formula immediately, based on all currently approved games.
select private.rebuild_league_ratings(
  null,
  'Switch league ratings to underdog-sensitive-elo-v2'
);
