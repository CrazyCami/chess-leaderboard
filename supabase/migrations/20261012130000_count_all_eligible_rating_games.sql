-- Count every approved, otherwise eligible game in the Elo replay. Keep the
-- private helper signature so the existing replay function needs no rewrite.

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
