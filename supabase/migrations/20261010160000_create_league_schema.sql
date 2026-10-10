-- Core league schema. This migration creates empty tables and access rules;
-- it does not insert player records or import games.

create type public.league_game_source as enum ('chess_com', 'manual');
create type public.league_game_result as enum ('white_win', 'draw', 'black_win');
create type public.league_review_status as enum ('pending', 'approved', 'rejected');
create type public.league_admin_action as enum ('approved', 'rejected', 'corrected_result');
create type public.league_player_result as enum ('win', 'draw', 'loss');
create type public.league_import_status as enum ('running', 'succeeded', 'failed');

create table public.players (
  id text primary key,
  display_name text not null check (length(trim(display_name)) > 0),
  chesscom_username text,
  chesscom_player_id bigint unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index players_chesscom_username_ci_unique
  on public.players (lower(chesscom_username))
  where chesscom_username is not null;

create table public.league_settings (
  singleton boolean primary key default true check (singleton),
  initial_rating numeric not null default 1000,
  k_factor numeric not null default 32 check (k_factor > 0),
  formula_version text not null default 'standard-elo-v1',
  updated_at timestamptz not null default now()
);

insert into public.league_settings (singleton) values (true);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  source public.league_game_source not null,
  source_game_url text,
  white_player_id text not null references public.players(id) on delete restrict,
  black_player_id text not null references public.players(id) on delete restrict,
  result public.league_game_result,
  white_source_result text,
  black_source_result text,
  played_at timestamptz not null,
  time_control text not null,
  rules text not null,
  review_status public.league_review_status not null default 'pending',
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_distinct_players check (white_player_id <> black_player_id),
  constraint chess_com_game_has_url check (
    source <> 'chess_com' or source_game_url is not null
  )
);

create unique index games_chesscom_source_url_unique
  on public.games (source_game_url)
  where source = 'chess_com' and source_game_url is not null;
create index games_review_status_played_at_idx
  on public.games (review_status, played_at);
create index games_white_player_played_at_idx
  on public.games (white_player_id, played_at);
create index games_black_player_played_at_idx
  on public.games (black_player_id, played_at);

create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete restrict,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id) on delete set null
);

create function public.is_league_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_league_admin() from public;
-- This helper exposes only whether the caller's own account is an admin.
grant execute on function public.is_league_admin() to anon, authenticated;

create table public.admin_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  game_id uuid not null references public.games(id) on delete restrict,
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action public.league_admin_action not null,
  decided_at timestamptz not null default now(),
  reason text,
  corrected_result public.league_game_result,
  constraint corrected_result_matches_action check (
    (action = 'corrected_result' and corrected_result is not null)
    or (action <> 'corrected_result' and corrected_result is null)
  )
);

create table public.rating_replays (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  reason text not null,
  initial_rating numeric not null,
  k_factor numeric not null check (k_factor > 0),
  formula_version text not null
);

create table public.rating_events (
  id uuid primary key default gen_random_uuid(),
  replay_id uuid not null references public.rating_replays(id) on delete restrict,
  game_id uuid not null references public.games(id) on delete restrict,
  player_id text not null references public.players(id) on delete restrict,
  opponent_id text not null references public.players(id) on delete restrict,
  played_at timestamptz not null,
  result public.league_player_result not null,
  rating_before numeric not null,
  rating_change numeric not null,
  rating_after numeric not null,
  constraint rating_event_players_differ check (player_id <> opponent_id),
  constraint rating_event_once_per_player_per_game unique (replay_id, game_id, player_id)
);

create index rating_events_replay_player_order_idx
  on public.rating_events (replay_id, player_id, played_at, game_id);

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status public.league_import_status not null default 'running',
  trigger_name text not null,
  players_checked integer not null default 0 check (players_checked >= 0),
  games_seen integer not null default 0 check (games_seen >= 0),
  games_inserted integer not null default 0 check (games_inserted >= 0),
  error_summary text
);

-- Admin decisions and rating replay outputs are audit records: corrections
-- create new decisions/replays instead of editing or deleting old records.
create function public.prevent_audit_record_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit records cannot be updated or deleted';
end;
$$;

create trigger admin_decisions_immutable
  before update or delete on public.admin_decisions
  for each row execute function public.prevent_audit_record_mutation();
create trigger rating_replays_immutable
  before update or delete on public.rating_replays
  for each row execute function public.prevent_audit_record_mutation();
create trigger rating_events_immutable
  before update or delete on public.rating_events
  for each row execute function public.prevent_audit_record_mutation();

alter table public.players enable row level security;
alter table public.league_settings enable row level security;
alter table public.games enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_decisions enable row level security;
alter table public.rating_replays enable row level security;
alter table public.rating_events enable row level security;
alter table public.import_runs enable row level security;

-- Browser clients can read the public roster/settings and approved results.
-- All writes go through trusted server code so it can enforce review/audit rules.
revoke all on public.players, public.league_settings, public.games,
  public.admin_users, public.admin_decisions, public.rating_replays,
  public.rating_events, public.import_runs from anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant select on public.players, public.league_settings to anon, authenticated;
grant select (
  id, source, source_game_url, white_player_id, black_player_id, result,
  white_source_result, black_source_result, played_at, time_control, rules,
  review_status, created_at, updated_at
) on public.games to anon, authenticated;
grant select (
  id, created_at, initial_rating, k_factor, formula_version
) on public.rating_replays to anon, authenticated;
grant select on public.rating_events to anon, authenticated;
grant select on public.admin_users, public.admin_decisions, public.import_runs
  to authenticated;
grant all on public.players, public.league_settings, public.games,
  public.admin_users, public.admin_decisions, public.rating_replays,
  public.rating_events, public.import_runs to service_role;

create policy players_public_read_active
  on public.players for select to anon, authenticated
  using (is_active or (select public.is_league_admin()));

create policy settings_public_read
  on public.league_settings for select to anon, authenticated
  using (singleton);

create policy games_public_read_approved
  on public.games for select to anon, authenticated
  using (review_status = 'approved' or (select public.is_league_admin()));

create policy admin_users_read_self_or_admin
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_league_admin()));

create policy admin_decisions_admin_read
  on public.admin_decisions for select to authenticated
  using ((select public.is_league_admin()));

create policy rating_replays_public_read
  on public.rating_replays for select to anon, authenticated
  using (true);

create policy rating_events_public_read_approved_games
  on public.rating_events for select to anon, authenticated
  using (
    (select public.is_league_admin())
    or exists (
      select 1
      from public.games
      where games.id = rating_events.game_id
        and games.review_status = 'approved'
    )
  );

create policy import_runs_admin_read
  on public.import_runs for select to authenticated
  using ((select public.is_league_admin()));

-- Public standings are derived from the latest immutable full replay. If no
-- replay exists yet, every active player receives the configured start value.
create view public.leaderboard
with (security_invoker = true)
as
with current_replay as (
  select id
  from public.rating_replays
  order by created_at desc, id desc
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

grant select on public.leaderboard to anon, authenticated;
