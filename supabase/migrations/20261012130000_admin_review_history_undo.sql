-- Preserve before/after game state for review history and safe reversals.
alter table public.admin_decisions
  add column result_before public.league_game_result,
  add column review_status_before public.league_review_status,
  add column review_note_before text,
  add column result_after public.league_game_result,
  add column review_status_after public.league_review_status,
  add column review_note_after text,
  add column reverses_decision_id uuid
    references public.admin_decisions(id) on delete restrict;

create unique index admin_decisions_reverses_once_idx
  on public.admin_decisions (reverses_decision_id)
  where reverses_decision_id is not null;

alter table public.admin_decisions
  drop constraint corrected_result_matches_action;
alter table public.admin_decisions
  add constraint corrected_result_matches_action check (
    (action = 'corrected_result' and corrected_result is not null)
    or (action <> 'corrected_result' and corrected_result is null)
    or (reverses_decision_id is not null and corrected_result is null)
  );

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
  v_result_before public.league_game_result;
  v_review_status_before public.league_review_status;
  v_review_note_before text;
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
  select decision.* into v_existing
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

  select game.* into v_game
    from public.games as game
   where game.id = p_game_id
   for update;
  if not found then
    raise exception 'Game does not exist.' using errcode = 'P0002';
  end if;
  if p_action = 'approved' and v_game.result is null then
    raise exception 'A game with an unknown result needs a corrected_result decision.' using errcode = '22023';
  end if;

  v_result_before := v_game.result;
  v_review_status_before := v_game.review_status;
  v_review_note_before := v_game.review_note;

  case p_action
    when 'approved' then
      update public.games set review_status = 'approved', review_note = v_reason,
        updated_at = pg_catalog.clock_timestamp() where id = p_game_id;
    when 'rejected' then
      update public.games set review_status = 'rejected', review_note = v_reason,
        updated_at = pg_catalog.clock_timestamp() where id = p_game_id;
    when 'corrected_result' then
      update public.games set result = p_corrected_result, review_status = 'approved',
        review_note = v_reason, updated_at = pg_catalog.clock_timestamp()
       where id = p_game_id;
  end case;

  v_replay_id := private.rebuild_league_ratings(
    v_admin_id, 'Admin review request ' || p_request_id::text
  );
  insert into public.admin_decisions (
    request_id, game_id, admin_user_id, action, reason, corrected_result,
    rating_replay_id, result_before, review_status_before, review_note_before,
    result_after, review_status_after, review_note_after
  )
  select p_request_id, p_game_id, v_admin_id, p_action, v_reason,
         p_corrected_result, v_replay_id, v_result_before,
         v_review_status_before, v_review_note_before,
         game.result, game.review_status, game.review_note
    from public.games as game
   where game.id = p_game_id
  returning id into v_decision_id;

  return query select v_decision_id, v_replay_id, false;
end;
$$;

create function private.undo_league_game_decision_internal(
  p_request_id uuid,
  p_decision_id uuid,
  p_reason text
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
  v_target public.admin_decisions%rowtype;
  v_game public.games%rowtype;
  v_latest_decision_id uuid;
  v_replay_id uuid;
  v_undo_id uuid;
begin
  if v_admin_id is null or not public.is_league_admin() then
    raise exception 'Only league admins can undo review decisions.' using errcode = '42501';
  end if;
  if p_request_id is null or p_decision_id is null then
    raise exception 'Request ID and decision ID are required.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to undo a decision.' using errcode = '22023';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'Reason must be 1000 characters or fewer.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 4711)
  );
  select decision.* into v_existing
    from public.admin_decisions as decision
   where decision.request_id = p_request_id;
  if found then
    if v_existing.admin_user_id is distinct from v_admin_id
       or v_existing.reverses_decision_id is distinct from p_decision_id
       or v_existing.reason is distinct from v_reason then
      raise exception 'Request ID was already used with a different undo.' using errcode = '23505';
    end if;
    return query select v_existing.id, v_existing.rating_replay_id, true;
    return;
  end if;

  select decision.* into v_target
    from public.admin_decisions as decision
   where decision.id = p_decision_id
   for update;
  if not found then
    raise exception 'Review decision does not exist.' using errcode = 'P0002';
  end if;
  if v_target.admin_user_id <> v_admin_id then
    raise exception 'You can only undo your own review decisions.' using errcode = '42501';
  end if;
  if v_target.reverses_decision_id is not null then
    raise exception 'An undo record cannot itself be undone. Record a new review decision instead.' using errcode = '22023';
  end if;
  if v_target.review_status_before is null
     or v_target.review_status_after is null then
    raise exception 'This older decision has no saved state and cannot be undone automatically.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.admin_decisions as reversal
     where reversal.reverses_decision_id = v_target.id
  ) then
    raise exception 'This decision has already been undone.' using errcode = '22023';
  end if;

  select decision.id into v_latest_decision_id
    from public.admin_decisions as decision
   where decision.game_id = v_target.game_id
   order by decision.decided_at desc, decision.id desc
   limit 1;
  if v_latest_decision_id is distinct from v_target.id then
    raise exception 'Only the latest decision for this game can be undone.' using errcode = '22023';
  end if;

  select game.* into v_game
    from public.games as game
   where game.id = v_target.game_id
   for update;
  if not found then
    raise exception 'The reviewed game no longer exists.' using errcode = 'P0002';
  end if;
  if v_game.result is distinct from v_target.result_after
     or v_game.review_status is distinct from v_target.review_status_after
     or v_game.review_note is distinct from v_target.review_note_after then
    raise exception 'The game changed after this decision. Make a new review decision instead.' using errcode = '22023';
  end if;

  update public.games
     set result = v_target.result_before,
         review_status = v_target.review_status_before,
         review_note = v_target.review_note_before,
         updated_at = pg_catalog.clock_timestamp()
   where id = v_target.game_id;

  v_replay_id := private.rebuild_league_ratings(
    v_admin_id, 'Undo admin review decision ' || v_target.id::text
  );

  insert into public.admin_decisions (
    request_id, game_id, admin_user_id, action, reason, corrected_result,
    rating_replay_id, result_before, review_status_before, review_note_before,
    result_after, review_status_after, review_note_after, reverses_decision_id
  )
  select p_request_id, v_target.game_id, v_admin_id, v_target.action,
         v_reason, v_target.corrected_result, v_replay_id,
         v_game.result, v_game.review_status, v_game.review_note,
         game.result, game.review_status, game.review_note, v_target.id
    from public.games as game
   where game.id = v_target.game_id
  returning id into v_undo_id;

  return query select v_undo_id, v_replay_id, false;
end;
$$;

revoke all on function private.undo_league_game_decision_internal(uuid, uuid, text)
  from public, anon;
grant execute on function private.undo_league_game_decision_internal(uuid, uuid, text)
  to authenticated;

create function public.undo_league_game_decision(
  p_request_id uuid,
  p_decision_id uuid,
  p_reason text
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
  select * from private.undo_league_game_decision_internal(
    p_request_id, p_decision_id, p_reason
  );
$$;

revoke all on function public.undo_league_game_decision(uuid, uuid, text)
  from public, anon;
grant execute on function public.undo_league_game_decision(uuid, uuid, text)
  to authenticated;
