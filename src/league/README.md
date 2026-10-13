# League backend rules

This folder contains Person 2's domain logic and the read-only leaderboard
connection. The page fetches the public `leaderboard` view from Supabase using
the publishable key in `.env.local`. The rating examples in `sample-data.ts`
are fictional. The hosted database contains the organizer-provided roster and
currently has no games.

## Current rules in code

- Every registered player starts at 1000.
- The default K-factor is 50. K controls how much a rating moves after a game;
  the settings are passed in, so the team can change it later.
- `elo.ts` uses the standard Elo expected-score equation. It does not round
  stored values. The UI can choose how many decimal places to display.
- Only approved standard-chess games with exactly 600 seconds and zero
  increment count. `600` and `600+0` are treated as equivalent.
- A game must have two different registered players, a known result, and a
  valid played-at timestamp.
- Pending and rejected games do not affect standings or history.
- Replay processes games by their played-at time, then game ID as a stable tie
  breaker. Adding a late game therefore rebuilds all later ratings in order.
- Rating history records the formula version and K-factor used for each game.
  A future formula change should increment the version and keep old audit
  records intact.

## Import and review behavior

`parseChessComResult` maps only result pairs the league currently recognizes.
Clear checkmate and resignation results can be auto-approved. For a resignation,
the player with the `resigned` result loses and their opponent's `win` determines
the winner. Draws, timeout or possible-timeout codes, generic losses, and unknown
result pairs remain pending for human review. An abandoned game counts as a
loss for the player who walked away, like a resignation. Aborted games (ended
before play began) are ignored entirely.

`mergeImportedGames` uses the Chess.com game URL as the stable source identity.
An identical re-import is a no-op. If a previously seen URL comes back with
different game facts, the existing game is retained and reported as a conflict
for review. The database enforces the source URL identity with a unique
constraint, so concurrent imports can be made safe too.

`applyAdminDecision` makes a repeat of the same decision ID and payload a no-op.
The database RPC in
`supabase/migrations/20261010180000_admin_review_rating_replay.sql` provides
the all-or-nothing persisted operation. It checks that the authenticated
account is a league admin, records the decision and a full replay, and accepts
a request UUID for retry safety. The organizer confirmed the migration was
successfully applied to Supabase. No admin login or review interface is wired
into the website yet.

## Still needed before this can run as the full league backend

- Admin sign-in, provisioning the first admin account, and a review interface.
  The RPC checks that a reviewer is an authenticated league admin.
- Apply the daily import and frequent-sync migrations and add GitHub Actions
  secrets, then enable the prepared workflow. Supabase Cron dispatches a
  current-month scan every five minutes and a full archive backfill daily;
  GitHub Actions runs the importer and calls a transactional database import
  RPC. Actual publication timing depends on GitHub Actions and Chess.com.
- A verified Chess.com response contract and result-code mapping before
  enabling automatic imports. See the project README/planning conversation
  for API questions to check against live documentation and sample responses.
- Person 3's QA of league edge cases and agreement on rules, especially
  correction/reversal policy, draw handling, and rating precision.

The local TypeScript functions are domain logic; the deployed SQL RPC is the
first durable review/replay path, pending an admin account and interface. Never
put privileged secrets in browser variables.
