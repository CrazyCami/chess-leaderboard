-- A player pair can contribute at most three approved, otherwise eligible
-- games to ratings in any rolling 12-hour window, independent of colours.

create or replace function private.league_rating_games_within_pair_limit()
returns table (game_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive eligible_games as (
    select game.id as game_id,
           case when game.white_player_id < game.black_player_id
                then game.white_player_id else game.black_player_id end as pair_player_1,
           case when game.white_player_id < game.black_player_id
                then game.black_player_id else game.white_player_id end as pair_player_2,
           game.played_at
      from public.games as game
     where game.review_status = 'approved'
       and game.result is not null
       and game.rules = 'chess'
       and game.time_control ~ '^[[:space:]]*0*600([+]0*)?[[:space:]]*$'
       and game.played_at >= timestamptz '2026-10-10 00:00:00 Europe/London'
       and game.white_player_id <> game.black_player_id
  ), ordered_games as (
    select eligible_games.*,
           row_number() over (
             partition by pair_player_1, pair_player_2
             order by played_at, game_id
           ) as pair_game_number
      from eligible_games
  ), capped_games (
    game_id, pair_player_1, pair_player_2, pair_game_number, played_at,
    accepted_1, accepted_2, accepted_3, within_limit
  ) as (
    select game_id, pair_player_1, pair_player_2, pair_game_number, played_at,
           null::timestamptz, null::timestamptz, played_at, true
      from ordered_games
     where pair_game_number = 1
    union all
    select next_game.game_id, next_game.pair_player_1, next_game.pair_player_2,
           next_game.pair_game_number, next_game.played_at,
           case when recent.recent_games < 3 then previous.accepted_2
                else previous.accepted_1 end,
           case when recent.recent_games < 3 then previous.accepted_3
                else previous.accepted_2 end,
           case when recent.recent_games < 3 then next_game.played_at
                else previous.accepted_3 end,
           recent.recent_games < 3
      from capped_games as previous
      join ordered_games as next_game
        on next_game.pair_player_1 = previous.pair_player_1
       and next_game.pair_player_2 = previous.pair_player_2
       and next_game.pair_game_number = previous.pair_game_number + 1
      cross join lateral (
        select
          (case when previous.accepted_1 > next_game.played_at - interval '12 hours' then 1 else 0 end)
          + (case when previous.accepted_2 > next_game.played_at - interval '12 hours' then 1 else 0 end)
          + (case when previous.accepted_3 > next_game.played_at - interval '12 hours' then 1 else 0 end)
          as recent_games
      ) as recent
  )
  select capped_games.game_id
    from capped_games
   where capped_games.within_limit;
$$;

revoke all on function private.league_rating_games_within_pair_limit()
  from public, anon, authenticated;
