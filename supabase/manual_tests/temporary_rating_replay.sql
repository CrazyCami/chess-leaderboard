begin;

create temporary table _league_rating_test_games (
  step integer primary key,
  label text not null,
  game_id uuid not null default gen_random_uuid()
) on commit drop;

insert into _league_rating_test_games (step, label)
values
  (1, 'Cami beats Walter'),
  (2, 'Felix beats Walter'),
  (3, 'Owen beats Felix');

insert into public.games (
  id, source, white_player_id, black_player_id, result, played_at,
  time_control, rules, review_status
)
select
  test_game.game_id,
  'manual',
  game.white_player_id,
  game.black_player_id,
  'white_win',
  game.played_at,
  '600+0',
  'chess',
  'approved'
from _league_rating_test_games as test_game
join (
  values
    (1, 'chesscom-icup0', 'chesscom-waltizer', timestamptz '2026-10-10 00:01:00 Europe/London'),
    (2, 'chesscom-daddyfelix11', 'chesscom-waltizer', timestamptz '2026-10-10 00:02:00 Europe/London'),
    (3, 'chesscom-stickler27', 'chesscom-daddyfelix11', timestamptz '2026-10-10 00:03:00 Europe/London')
) as game(step, white_player_id, black_player_id, played_at)
  on game.step = test_game.step;

create temporary table _league_rating_test_replay (replay_id uuid) on commit drop;
insert into _league_rating_test_replay (replay_id)
select private.rebuild_league_ratings(null, 'Temporary rollback-only Elo smoke check');

select
  test_game.step,
  test_game.label,
  player.display_name,
  event.result,
  round(event.rating_before, 2) as rating_before,
  round(event.rating_change, 2) as rating_change,
  round(event.rating_after, 2) as rating_after
from _league_rating_test_games as test_game
join public.rating_events as event
  on event.game_id = test_game.game_id
join _league_rating_test_replay as replay
  on replay.replay_id = event.replay_id
join public.players as player
  on player.id = event.player_id
order by test_game.step, player.display_name;

rollback;
