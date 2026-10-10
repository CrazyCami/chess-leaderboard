# Supabase setup status

The first migration creates league tables, duplicate-prevention constraints,
row-level access policies, admin audit tables, and a public leaderboard view.
The organizer confirmed those schema objects are present in the hosted project
and successfully ran the player seed migration. The Next.js app now reads the
public leaderboard view using the Supabase URL and publishable key in
`.env.local`.

## Apply migrations manually

1. The initial schema migration,
   `migrations/20261010160000_create_league_schema.sql`, should already be
   applied. Do not run it again; its `create type` statements are not repeatable.
2. The seed migration `migrations/20261010170000_seed_initial_players.sql` has
   already been run. It is safe to re-run for the same player IDs if needed.

Keep database passwords and Supabase secret/service keys out of this
repository and out of browser code. The roster seed contains only the player
names and usernames already provided for this league; it does not add games.

## What remains

- The public leaderboard is connected and read-only.
- The migration grants browser clients read access to the active roster,
  settings, approved games, approved rating events, and leaderboard view.
  Pending games and admin-only records are restricted.
- Browser clients cannot write league records. Secure server functions still
  need to validate admins and atomically save imports, decisions, and rating
  replays.
- No admin account is configured yet.
- The Chess.com importer and 16:00 Europe/London scheduled sync are not built.
- GitHub deployment integration is optional and has not been connected.
