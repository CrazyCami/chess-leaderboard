-- Organizer-provided roster addition. Safe to re-run for this player ID.

insert into public.players (id, display_name, chesscom_username)
values ('chesscom-mediocrechessskill', 'Teddy', 'MediocreChessSkill')
on conflict (id) do update
set display_name = excluded.display_name,
    chesscom_username = excluded.chesscom_username,
    is_active = true,
    updated_at = now();
