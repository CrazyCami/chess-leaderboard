-- Organizer-provided roster update. Safe to re-run for these player IDs.
-- Existing rating history and games remain attached to Alek's stable player ID.

insert into public.players (id, display_name, chesscom_username)
values
  ('chesscom-alexsander123456789012', 'Alek', 'aleksander123456789012'),
  ('chesscom-michi33m', 'Pablo', 'michi33m')
on conflict (id) do update
set display_name = excluded.display_name,
    chesscom_username = excluded.chesscom_username,
    is_active = true,
    updated_at = now();
