-- Initial organizer-provided roster. Safe to re-run for these player IDs.
-- No games are added; everyone remains at the configured starting rating.

insert into public.players (id, display_name, chesscom_username)
values
  ('chesscom-icup0', 'Cami', 'icup0'),
  ('chesscom-abelloooooo', 'Abel', 'abelloooooo'),
  ('chesscom-vablosdiarchess', 'Calder', 'VablosdiarChess'),
  ('chesscom-daddyfelix11', 'Felix', 'daddyfelix11'),
  ('chesscom-ytfkwvdj', 'Zac', 'ytfkwvDJ'),
  ('chesscom-stickler27', 'Owen', 'Stickler27'),
  ('chesscom-pp-destroyer67', 'Peyton', 'PP-destroyer67'),
  ('chesscom-ur-playing-checkers1', 'Max', 'UR-PLAYING-CHECKERS1'),
  ('chesscom-sigmarizzled23', 'Ethan', 'SigmaRizzled23')
on conflict (id) do update
set display_name = excluded.display_name,
    chesscom_username = excluded.chesscom_username,
    is_active = true,
    updated_at = now();
