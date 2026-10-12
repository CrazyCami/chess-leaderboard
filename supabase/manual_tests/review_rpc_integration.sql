-- Run only in a staging Supabase project after all migrations are applied.
-- Replace the UUID below with an existing user_id from public.admin_users.
-- The transaction rolls back its temporary game, decision, and rating replay.
begin;

select set_config('league_test.admin_user_id', 'REPLACE_WITH_STAGING_ADMIN_USER_UUID', true);

do $$
declare
  v_admin_id uuid := current_setting('league_test.admin_user_id')::uuid;
  v_white_id text;
  v_black_id text;
  v_game_id uuid := gen_random_uuid();
  v_request_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.admin_users where user_id = v_admin_id) then
    raise exception 'The supplied user is not provisioned as a league admin.';
  end if;

  select id into v_white_id from public.players where is_active order by id limit 1;
  select id into v_black_id from public.players where is_active and id <> v_white_id order by id limit 1;
  if v_white_id is null or v_black_id is null then
    raise exception 'At least two active players are required for this integration test.';
  end if;

  insert into public.games (
    id, source, white_player_id, black_player_id, result, played_at,
    time_control, rules, review_status
  ) values (
    v_game_id, 'manual', v_white_id, v_black_id, null, now(),
    '600', 'chess', 'pending'
  );

  perform set_config('league_test.game_id', v_game_id::text, true);
  perform set_config('league_test.request_id', v_request_id::text, true);
  perform set_config('request.jwt.claim.sub', v_admin_id::text, true);
end;
$$;

-- Use a fresh pair so pre-existing staging games cannot affect the replay test.
do $$
declare
  v_pair_id text := gen_random_uuid()::text;
  v_white_id text := 'replay-white-' || v_pair_id;
  v_black_id text := 'replay-black-' || v_pair_id;
  v_game_ids uuid[] := array[]::uuid[];
  v_game_id uuid;
  v_replay_id uuid;
  v_event_count integer;
  v_fifth_game_event_count integer;
  v_index integer;
begin
  insert into public.players (id, display_name)
  values (v_white_id, 'Replay test white'), (v_black_id, 'Replay test black');

  for v_index in 0..4 loop
    v_game_id := gen_random_uuid();
    v_game_ids := pg_catalog.array_append(v_game_ids, v_game_id);
    insert into public.games (
      id, source, white_player_id, black_player_id, result, played_at,
      time_control, rules, review_status
    ) values (
      v_game_id, 'manual',
      case when v_index % 2 = 0 then v_white_id else v_black_id end,
      case when v_index % 2 = 0 then v_black_id else v_white_id end,
      'white_win',
      timestamptz '2026-10-11 12:00:00+00' + make_interval(hours => v_index),
      '600', 'chess', 'approved'
    );
  end loop;

  v_replay_id := private.rebuild_league_ratings(
    null, 'Staging all eligible games integration test'
  );
  select count(*) into v_event_count
    from public.rating_events
   where replay_id = v_replay_id and game_id = any(v_game_ids);
  select count(*) into v_fifth_game_event_count
    from public.rating_events
   where replay_id = v_replay_id and game_id = v_game_ids[5];

  if v_event_count <> 10 or v_fifth_game_event_count <> 2 then
    raise exception 'Expected five counted games (ten events), including two events for game five; got % events total and % for game five.',
      v_event_count, v_fifth_game_event_count;
  end if;
end;
$$;

set local role authenticated;

do $$
declare
  v_game_id uuid := current_setting('league_test.game_id')::uuid;
  v_request_id uuid := current_setting('league_test.request_id')::uuid;
  v_result record;
  v_game public.games%rowtype;
  v_decision public.admin_decisions%rowtype;
  v_event_count integer;
begin
  if not public.is_league_admin() then
    raise exception 'Admin membership check failed for the provisioned account.';
  end if;

  begin
    perform 1 from public.review_league_game(
      gen_random_uuid(), v_game_id, 'approved', 'Integration test', null
    );
    raise exception 'An unknown result was incorrectly approved without correction.';
  exception
    when sqlstate '22023' then null;
  end;

  select * into v_result from public.review_league_game(
    v_request_id, v_game_id, 'corrected_result',
    'Staging integration test: correct unknown result to draw.', 'draw'
  );
  if v_result.was_retry then
    raise exception 'The first decision was unexpectedly treated as a retry.';
  end if;

  select * into v_result from public.review_league_game(
    v_request_id, v_game_id, 'corrected_result',
    'Staging integration test: correct unknown result to draw.', 'draw'
  );
  if not v_result.was_retry then
    raise exception 'Retrying the same request did not return was_retry=true.';
  end if;

  begin
    perform 1 from public.review_league_game(
      v_request_id, v_game_id, 'corrected_result',
      'Changed reason must not reuse a request ID.', 'draw'
    );
    raise exception 'A changed decision payload incorrectly reused the request ID.';
  exception
    when unique_violation then null;
  end;

  select * into v_game from public.games where id = v_game_id;
  if v_game.result <> 'draw' or v_game.review_status <> 'approved' then
    raise exception 'The corrected game was not approved as a draw.';
  end if;

  select * into v_decision from public.admin_decisions where request_id = v_request_id;
  if v_decision.action <> 'corrected_result'
     or v_decision.admin_user_id <> current_setting('league_test.admin_user_id')::uuid
     or v_decision.reason is null then
    raise exception 'The admin decision audit record is missing or incorrect.';
  end if;

  select count(*) into v_event_count
    from public.rating_events
   where replay_id = v_decision.rating_replay_id and game_id = v_game_id;
  if v_event_count <> 2 then
    raise exception 'Expected two rating events for the corrected game; got %.', v_event_count;
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);

do $$
begin
  if public.is_league_admin() then
    raise exception 'An unprovisioned account was incorrectly treated as an admin.';
  end if;

  begin
    perform 1 from public.review_league_game(
      gen_random_uuid(),
      current_setting('league_test.game_id')::uuid,
      'rejected',
      'This account must not be allowed to reject games.',
      null
    );
    raise exception 'An unprovisioned account was allowed to review a game.';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

rollback;
