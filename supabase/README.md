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

Keep database passwords and Supabase secret/service keys out of this
repository and out of browser code. The roster seed contains only the player
names and usernames already provided for this league; it does not add games.

## What remains

- The public leaderboard is connected and read-only.
- The migration grants browser clients read access to the active roster,
  settings, approved games, approved rating events, and leaderboard view.
  Pending games and admin-only records are restricted.
- The admin review RPC is installed in the hosted database. It requires an
  authenticated account already listed in
  `admin_users`; admin account setup and a review interface are not built yet.
  Keep the `private` schema out of Supabase's exposed schemas; the callable
  `public.review_league_game` endpoint is a restricted invoker wrapper.
- The review RPC accepts a UUID `request_id`. Reuse that same ID when retrying
  the same decision, and create a new ID for a new decision.
- Each new review decision creates a complete rating replay. Only approved
  standard chess games with a 600-second base and zero increment (`600` or
  `600+0`, with optional surrounding whitespace) count.
- Browser clients still cannot write league records directly. Import saving
  and scheduling are not built yet.
- The Chess.com importer and 16:00 Europe/London scheduled sync are not built.
- GitHub deployment integration is optional and has not been connected.
