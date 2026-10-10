-- Admin review decisions and a complete rating replay are written in one RPC
-- transaction. Calling the same request_id with the same payload is a no-op.

alter table public.rating_replays
  add column replay_generation bigint generated always as identity unique;

alter table public.admin_decisions
  add column rating_replay_id uuid references public.rating_replays(id) on delete restrict;

grant select (replay_generation) on public.rating_replays to anon, authenticated;

-- Supabase's Data API should not expose this schema. The public RPC below is
-- only an invoker wrapper; all privileged table writes happen in this schema.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace view public.leaderboard
with (security_invoker = true)
as
with current_replay as (
  select id
  from public.rating_replays
  order by replay_generation desc
  limit 1
), replay_stats as (
  select
    event.player_id,
    count(*)::integer as games_played,
    count(*) filter (where event.result = 'win')::integer as wins,
    count(*) filter (where event.result = 'draw')::integer as draws,
    count(*) filter (where event.result = 'loss')::integer as losses
  from public.rating_events as event
  join current_replay on current_replay.id = event.replay_id
  group by event.player_id
), latest_rating as (
  select distinct on (event.player_id)
    event.player_id,
    event.rating_after
  from public.rating_events as event
  join current_replay on current_replay.id = event.replay_id
  order by event.player_id, event.played_at desc, event.game_id desc
)
select
  player.id as player_id,
  player.display_name,
  player.chesscom_username,
  coalesce(latest_rating.rating_after, settings.initial_rating) as rating,
  coalesce(replay_stats.wins, 0) as wins,
  coalesce(replay_stats.draws, 0) as draws,
  coalesce(replay_stats.losses, 0) as losses,
  coalesce(replay_stats.games_played, 0) as games_played
from public.players as player
cross join public.league_settings as settings
left join replay_stats on replay_stats.player_id = player.id
left join latest_rating on latest_rating.player_id = player.id
where player.is_active and settings.singleton;

create function private.review_league_game_internal(
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
  v_game_row record;
begin
  if v_admin_id is null or not public.is_league_admin() then
    raise exception 'Only league admins can review games.' using errcode = '42501';
  end if;
  if p_request_id is null or p_game_id is null or p_action is null then
    raise exception 'Request ID, game ID, and action are required.' using errcode = '22023';
  end if;
  if length(coalesce(v_reason, '')) > 1000 then
    raise exception 'Reason must be 1000 characters or fewer.' using errcode = '22023';
  end if;
  if (p_action = 'corrected_result' and p_corrected_result is null)
     or (p_action <> 'corrected_result' and p_corrected_result is not null) then
    raise exception 'Corrected result must be provided only for corrected_result.' using errcode = '22023';
  end if;

  -- Serialize identical request IDs before checking the idempotency record.
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

  -- Only one full replay may be published at once. Every decision computes
  -- ratings from all approved, eligible games, so late results are replayed
  -- chronologically without applying an Elo change twice.
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
    v_admin_id,
    'Admin review request ' || p_request_id::text,
    v_initial_rating,
    v_k_factor,
    v_formula_version
  ) returning id into v_replay_id;

  insert into public.admin_decisions (
    request_id, game_id, admin_user_id, action, reason,
    corrected_result, rating_replay_id
  ) values (
    p_request_id, p_game_id, v_admin_id, p_action, v_reason,
    p_corrected_result, v_replay_id
  );

  for v_game_row in
    select game.id, game.white_player_id, game.black_player_id,
           game.result, game.played_at
      from public.games as game
     where game.review_status = 'approved'
       and game.result is not null
       and game.rules = 'chess'
       and game.time_control ~ '^[[:space:]]*0*600([+]0*)?[[:space:]]*$'
       and game.white_player_id <> game.black_player_id
     order by game.played_at, game.id
  loop
    if not (v_game_row.white_player_id = any(v_player_ids)) then
      v_player_ids := pg_catalog.array_append(v_player_ids, v_game_row.white_player_id);
      v_ratings := pg_catalog.array_append(v_ratings, v_initial_rating);
    end if;
    if not (v_game_row.black_player_id = any(v_player_ids)) then
      v_player_ids := pg_catalog.array_append(v_player_ids, v_game_row.black_player_id);
      v_ratings := pg_catalog.array_append(v_ratings, v_initial_rating);
    end if;

    v_white_index := pg_catalog.array_position(v_player_ids, v_game_row.white_player_id);
    v_black_index := pg_catalog.array_position(v_player_ids, v_game_row.black_player_id);
    v_white_expected := 1 / (
      1 + pg_catalog.power(10::numeric,
        (v_ratings[v_black_index] - v_ratings[v_white_index]) / 400)
    );
    v_black_expected := 1 / (
      1 + pg_catalog.power(10::numeric,
        (v_ratings[v_white_index] - v_ratings[v_black_index]) / 400)
    );

    case v_game_row.result
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
      (v_replay_id, v_game_row.id, v_game_row.white_player_id,
       v_game_row.black_player_id, v_game_row.played_at,
       case v_game_row.result
         when 'white_win' then 'win'::public.league_player_result
         when 'draw' then 'draw'::public.league_player_result
         when 'black_win' then 'loss'::public.league_player_result
       end,
       v_ratings[v_white_index], v_white_change,
       v_ratings[v_white_index] + v_white_change),
      (v_replay_id, v_game_row.id, v_game_row.black_player_id,
       v_game_row.white_player_id, v_game_row.played_at,
       case v_game_row.result
         when 'white_win' then 'loss'::public.league_player_result
         when 'draw' then 'draw'::public.league_player_result
         when 'black_win' then 'win'::public.league_player_result
       end,
       v_ratings[v_black_index], v_black_change,
       v_ratings[v_black_index] + v_black_change);

    v_ratings[v_white_index] := v_ratings[v_white_index] + v_white_change;
    v_ratings[v_black_index] := v_ratings[v_black_index] + v_black_change;
  end loop;

  return query select decision.id, decision.rating_replay_id, false
    from public.admin_decisions as decision
   where decision.request_id = p_request_id;
end;
$$;

revoke all on function private.review_league_game_internal(
  uuid, uuid, public.league_admin_action, text, public.league_game_result
) from public, anon;
grant execute on function private.review_league_game_internal(
  uuid, uuid, public.league_admin_action, text, public.league_game_result
) to authenticated;

create function public.review_league_game(
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
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.review_league_game_internal(
    p_request_id, p_game_id, p_action, p_reason, p_corrected_result
  );
$$;

revoke all on function public.review_league_game(
  uuid, uuid, public.league_admin_action, text, public.league_game_result
) from public, anon;
grant execute on function public.review_league_game(
  uuid, uuid, public.league_admin_action, text, public.league_game_result
) to authenticated;
