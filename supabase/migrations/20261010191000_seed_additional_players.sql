-- Additional organizer-provided roster entries. Safe to re-run for these IDs.
-- No games are added; these players start at the configured league rating.

insert into public.players (id, display_name, chesscom_username)
values
  ('chesscom-justdoit0071', 'David', 'JustDoIt0071'),
  ('chesscom-waltizer', 'Walter', 'Waltizer'),
  ('chesscom-alexsander123456789012', 'Alex', 'alexsander123456789012')
on conflict (id) do update
set display_name = excluded.display_name,
    chesscom_username = excluded.chesscom_username,
    is_active = true,
    updated_at = now();
