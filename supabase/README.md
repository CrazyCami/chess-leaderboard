# Supabase setup status

The first migration creates league tables, duplicate-prevention constraints,
row-level access policies, admin audit tables, and a public leaderboard view.
The organizer confirmed those schema objects are present in the hosted project
and successfully ran the player seed migration. The Next.js app now reads the
public leaderboard view using the Supabase URL and publishable key in
`.env.local`.

The migration `migrations/20261010180000_admin_review_rating_replay.sql` adds
the database-side admin review operation. The organizer confirmed it was
successfully applied to the hosted project.

## Apply migrations manually

1. The initial schema migration,
   `migrations/20261010160000_create_league_schema.sql`, should already be
   applied. Do not run it again; its `create type` statements are not repeatable.
2. The seed migration `migrations/20261010170000_seed_initial_players.sql` has
   already been run. It is safe to re-run for the same player IDs if needed.
3. The admin review/rating replay migration has also been applied. Do not run
   it again; it adds identity and audit columns and is not repeatable.
4. The daily import migration,
   `migrations/20261010190000_chesscom_daily_import.sql`, is applied to the
   hosted project. Do not run it again there. For a new project, apply it once
   after the schema and admin review migrations and before enabling imports.
5. The admin review UI now requires a reason for each decision. Apply
   `migrations/20261011151100_require_admin_decision_reason.sql` once in
   Supabase SQL Editor. It preserves older audit rows but rejects new decisions
   without a nonblank reason.
6. Apply `migrations/20261012120000_pair_game_rating_limit.sql` once to enforce
   the three-games-per-pair rolling 12-hour rating limit in both imports and
   admin-triggered rating replays. Until it is applied, hosted ratings do not
   enforce this limit.
7. Apply `migrations/20261013162800_allow_frequent_chesscom_sync.sql` once to
   allow repeated Chess.com imports on the same London date. The scheduled
   GitHub workflow polls the current archive month every five minutes and
   backfills all months daily. GitHub and Chess.com do not guarantee that a
   game will appear on the website within exactly five minutes.

Keep database passwords and Supabase secret/service keys out of this
repository and out of browser code. The roster seed contains only the player
names and usernames already provided for this league; it does not add games.

## What remains

- The public leaderboard is connected and read-only.
- The migration grants browser clients read access to the active roster,
  settings, approved games, approved rating events, and leaderboard view.
  Pending games and admin-only records are restricted.
- The admin review RPC is installed in the hosted database. It requires an
  authenticated account already listed in `admin_users`. The website now has
  a `/review` sign-in and review queue; `/admin` redirects there. Only the
  authenticated RPC can change games. Keep the `private` schema out of
  Supabase's exposed schemas; the callable `public.review_league_game` endpoint
  is a restricted invoker wrapper.
  Provision each named admin through the school-approved Supabase Auth invite
  process, then add only that account's Auth UUID to `admin_users` using the
  Supabase SQL Editor, for example:

  ```sql
  insert into public.admin_users (user_id)
  select id from auth.users where lower(email) = lower('REPLACE_WITH_ADMIN_EMAIL')
  on conflict (user_id) do nothing;
  ```

  Confirm that exactly one row was inserted or already existed. Never expose
  an admin/service key to browser code.
- The review RPC accepts a UUID `request_id`. Reuse that same ID when retrying
  the same decision, and create a new ID for a new decision.
- Each new review decision creates a complete rating replay. Only approved
  standard chess games with a 600-second base and zero increment (`600` or
  `600+0`, with optional surrounding whitespace) count, subject to the
  three-games-per-pair rolling 12-hour cap. The cap is enforced in the
  database replay, not by Chess.com, so it doesn't prevent excess play.
- Browser clients still cannot write league records directly. The importer,
  workflow, import migration, and Actions secrets are configured. Apply the
  frequent-sync migration before enabling the five-minute polling workflow.
  A manual workflow run on 10 October 2026 completed successfully, checked 9
  roster accounts, and imported 0 games. This verifies that run reached the
  database RPC; it does not verify a scheduled run or prove that game data has
  been imported.
- `manual_tests/review_rpc_integration.sql` is a staging-only transaction test.
  Replace the admin UUID placeholder and run the entire script in Supabase SQL
  Editor after applying the migrations. It rolls back its temporary game and
  checks the RPC permission, correction, audit, rating replay, retry, and
  three-games-per-pair cap paths.
  It has not yet been run against the hosted project.
