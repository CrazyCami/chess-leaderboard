# League backend rules

This folder is a local, framework-independent starting point for Person 2's
work. It has no database connection, authentication, or network calls. The
rating examples in `sample-data.ts` are fictional. `roster.ts` contains the
three Chess.com usernames supplied for the league; until names are provided,
the username is also used as a temporary display name. The website page still
uses its separate fictional placeholders.

## Current rules in code

- Every registered player starts at 1000.
- The default K-factor is 32. K controls how much a rating moves after a game;
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
Unclear or new Chess.com result codes return `null`, which should become a
pending review rather than an automatic rating update.

`mergeImportedGames` uses the Chess.com game URL as the stable source identity.
An identical re-import is a no-op. If a previously seen URL comes back with
different game facts, the existing game is retained and reported as a conflict
for review. A future database must enforce this identity with a unique
constraint, so concurrent imports are safe too.

`applyAdminDecision` makes a repeat of the same decision ID and payload a no-op.
It returns new state rather than persisting it. In the database, applying the
decision, updating the game, and rebuilding affected ratings must happen in one
transaction (one all-or-nothing database operation). Admin identity must come
from server-verified authentication, never from a browser-supplied ID alone.

## Still needed before this can run as the league backend

- Supabase tables, unique constraints, row-level security rules, and database
  functions or server-only code to persist imports, review decisions, and
  rating snapshots atomically.
- Admin sign-in and authorization. Public users should be able to read only
  approved league data; only authorized admins may decide reviews.
- The daily scheduled importer at 16:00 Europe/London. The scheduler must use
  the IANA timezone so daylight-saving changes are handled; it should enqueue
  an idempotent sync and record each run.
- A verified Chess.com response contract and result-code mapping before
  enabling automatic imports. See the project README/planning conversation
  for API questions to check against live documentation and sample responses.
- Person 3's QA of league edge cases and agreement on rules, especially
  correction/reversal policy, draw handling, and rating precision.

The current functions are domain logic, not production security or durable
storage. Do not put secrets in browser variables, and do not add real players
until the team is ready to load them.
