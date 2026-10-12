-- Correct Alex's Chess.com handle without changing the stable league player ID.
update public.players
   set chesscom_username = 'aleksander123456789012',
       updated_at = now()
 where id = 'chesscom-alexsander123456789012'
   and chesscom_username = 'alexsander123456789012';
