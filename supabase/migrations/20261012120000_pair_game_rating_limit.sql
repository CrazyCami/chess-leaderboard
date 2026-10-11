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

create or replace function private.review_league_game_internal(
  p_request_id uuid,
  p_game_id uuid,
  p_action public.league_admin_action,
  p_reason text default null,
  p_corrected_result public.league_game_result default null
)
returns table (
  decision_id uuid,
  replay_id uuid,
  was_retry boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid := auth.uid();
  v_reason text := nullif(trim(p_reason), '');
  v_existing public.admin_decisions%rowtype;
  v_game public.games%rowtype;
  v_replay_id uuid;
  v_decision_id uuid;
begin
  if v_admin_id is null or not public.is_league_admin() then
    raise exception 'Only league admins can review games.' using errcode = '42501';
  end if;
  if p_request_id is null or p_game_id is null or p_action is null then
    raise exception 'Request ID, game ID, and action are required.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'A reason is required for every admin decision.' using errcode = '22023';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'Reason must be 1000 characters or fewer.' using errcode = '22023';
  end if;
  if (p_action = 'corrected_result' and p_corrected_result is null)
     or (p_action <> 'corrected_result' and p_corrected_result is not null) then
    raise exception 'Corrected result must be provided only for corrected_result.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 4711)
  );
  select decision.*
    into v_existing
    from public.admin_decisions as decision
   where decision.request_id = p_request_id;

  if found then
    if v_existing.game_id is distinct from p_game_id
       or v_existing.admin_user_id is distinct from v_admin_id
       or v_existing.action is distinct from p_action
       or v_existing.reason is distinct from v_reason
       or v_existing.corrected_result is distinct from p_corrected_result then
      raise exception 'Request ID was already used with a different decision.' using errcode = '23505';
    end if;
    return query select v_existing.id, v_existing.rating_replay_id, true;
    return;
  end if;

  select game.*
    into v_game
    from public.games as game
   where game.id = p_game_id
   for update;
  if not found then
    raise exception 'Game does not exist.' using errcode = 'P0002';
  end if;
  if p_action = 'approved' and v_game.result is null then
    raise exception 'A game with an unknown result needs a corrected_result decision.' using errcode = '22023';
  end if;

  case p_action
    when 'approved' then
      update public.games
         set review_status = 'approved',
             review_note = v_reason,
             updated_at = pg_catalog.clock_timestamp()
       where id = p_game_id;
    when 'rejected' then
      update public.games
         set review_status = 'rejected',
             review_note = v_reason,
             updated_at = pg_catalog.clock_timestamp()
       where id = p_game_id;
    when 'corrected_result' then
      update public.games
         set result = p_corrected_result,
             review_status = 'approved',
             review_note = v_reason,
             updated_at = pg_catalog.clock_timestamp()
       where id = p_game_id;
  end case;

  v_replay_id := private.rebuild_league_ratings(
    v_admin_id, 'Admin review request ' || p_request_id::text
  );
  insert into public.admin_decisions (
    request_id, game_id, admin_user_id, action, reason,
    corrected_result, rating_replay_id
  ) values (
    p_request_id, p_game_id, v_admin_id, p_action, v_reason,
    p_corrected_result, v_replay_id
  ) returning id into v_decision_id;

  return query select v_decision_id, v_replay_id, false;
end;
$$;

revoke all on function private.review_league_game_internal(
  uuid, uuid, public.league_admin_action, text, public.league_game_result
) from public, anon;
grant execute on function private.review_league_game_internal(
  uuid, uuid, public.league_admin_action, text, public.league_game_result
) to authenticated;
