# School Chess League

A Next.js and TypeScript school year-group chess league. The leaderboard can read active player standings from the Supabase `leaderboard` view using a public publishable key and database row-level security (RLS).

## Run locally

1. Install Node.js (20.9 or newer) and npm.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`, then set the Supabase project URL and publishable key from your Supabase project’s Connect dialog.
4. Run `npm run dev`.
5. Open [http://localhost:3000](http://localhost:3000).

The public page reads standings from Supabase. Admin sign-in and the review interface are not built yet. Never use a Supabase secret key in a `NEXT_PUBLIC_` variable. Keep `.env.local` private; Git ignores it.

## Website interface

The public page (`app/page.tsx`, rendered by `src/league/LeagueDashboard.tsx`)
reads only public, row-level-secured data with the publishable key:

- `leaderboard` view for the standings table (rank, league Elo, W–D–L record,
  games). Players with no rated games show a blank rank.
- `rating_replays` (latest generation), `rating_events` and approved `games`
  for the per-player form and trend columns, the rating history chart, the
  recent games scoresheet and the "standings as of" time.
- `league_settings` for the starting rating and K-factor shown in the facts
  row.

If the history queries fail the standings still render; the chart and game
panels show a quiet message instead. Pure display helpers live in
`src/league/league-view.ts` and are covered by `npm test`. The chart assigns
each player a fixed colour slot (up to eight shown at once) so colours never
change when other players are hidden. The page follows the system light/dark
setting.

## Team roles

- Person 1 owns the website interface and visual design.
- Person 2 owns backend logic, the database, imports, duplicate prevention, and ratings.
- Person 3 owns league rules, review-process decisions, and QA.

Use fictional data while developing features. Public student names/usernames should only be loaded after the league agrees to publish them. Privileged credentials must stay server-side and must never use a `NEXT_PUBLIC_` environment variable.

## League operating rules

These are the rules currently enforced by the database and rating code. The
organizer should confirm them with the school and players before the first
counted game; changing a rule later can change standings.

- **Eligible games:** registered players only; standard chess; 10 minutes with
  zero increment (`600` or `600+0`); played on or after midnight
  Europe/London on 10 October 2026. Games must have two different players, a
  recognized result, and a valid played-at time.
- **Ratings:** every player starts at 1000. Use standard Elo
  (`standard-elo-v1`) with K-factor 50. Ratings are unrounded in storage and
  replay, and displayed to the nearest whole point. Rankings use the unrounded
  rating. Chess.com ratings do not affect league ratings. Games are replayed
  chronologically, with game ID as the stable tie-breaker; late approvals can
  therefore change later results.
- **Outcomes:** Elo uses 1 for a win, 0.5 for a draw, and 0 for a loss. The
  opponent receives the complementary score. An abandoned game (a player left a
  live game) is a loss for that player. An aborted game (ended before play
  began) is excluded entirely: it creates no rating event and changes neither
  player's rating. A game is not counted until approved.
- **Game counting:** Every approved game that meets the league's eligibility
  rules counts toward both players' ratings, including multiple games between
  the same pair in a short period.
- **League scope:** there is no separate season reset or inactivity penalty in
  the current implementation. Do not promise either until the school has
  agreed a policy and it has been implemented.

### Questionable-game approval

The import automatically approves recognized decisive checkmate and
resignation results. The player whose result is `resigned` loses; their
opponent's `win` records the winner. Draws, timeouts, generic losses, uncertain
or unknown result codes remain pending for review. An abandoned game is a loss
for the player who walked away; aborted games are ignored. Pending and rejected
games do not affect the leaderboard.

1. A designated league admin checks the source game, both players, date, time
   control, variant, and result. Ask both players or a supervising staff member
   when the source record alone does not resolve a disagreement.
2. The admin records one decision: **approve** a clear result, **reject** an
   ineligible or unverifiable game, or **correct result** to the verified
   outcome. Record a concise reason, especially for rejection or correction.
   Unknown results cannot be approved as-is.
3. Decisions are written through the authenticated admin-only database RPC.
   Each action is audited and causes a full chronological rating replay.
   Retries must reuse the same request ID and payload. Corrections are new
   audited decisions, not edits to old audit records.
4. If a player disputes a decision, pause further manual changes to that game,
   gather evidence, and have an admin review it through `/review`. This page
   requires a Supabase Auth account provisioned in `admin_users` and the
   reason-required database migration to be applied. Until both setup steps are
   complete, use a school-approved, access-controlled channel instead.

Before opening the leaderboard to students, get school approval for publishing
names and Chess.com usernames. Never publish contact details, private review
notes, or admin data.

## Readiness, QA, and next work

This is a readiness tracker, not a claim that the live school workflow has
passed these checks. A task marked **blocked** needs its stated prerequisite;
the owner should update this list with the result and date when it is done.

### Acceptance checks

| Area | Check | Expected result | Status |
| --- | --- | --- | --- |
| Ratings | White wins from equal 1000 ratings, K=50 | White 1025, Black 975 | Not re-verified after K update |
| Ratings | Black wins from equal 1000 ratings, K=50 | White 975, Black 1025 | Not re-verified after K update |
| Ratings | Draw from equal 1000 ratings, K=50 | Both remain 1000 | Not re-verified after K update |
| Results | Recognized checkmate win/loss pair | Correct winner; eligible for auto-approval | Unit test passed locally; CI pending |
| Results | Agreed draw, stalemate, repetition, insufficient material, 50-move draw | Draw; pending admin review | Unit tests passed locally; CI pending |
| Results | Resignation and opponent win | Resigning player loses; result is auto-approved and counted in Elo | Unit test passed locally |
| Results | Timeout with a winner | Correct winner; pending admin review | Unit tests passed locally; CI pending |
| Results | Abandoned game | Loss for the player who abandoned; approved automatically | Unit test passed locally; CI pending |
| Results | Aborted game | Excluded from Elo; no rating event or rating change for either player | Unit test passed locally; CI pending |
| Results | Unknown, conflicting, or malformed result pair | Pending; cannot approve without correction | Core unknown/conflicting cases passed locally; malformed payload case still needs a test |
| Eligibility | Variant, time control, date, player, or timestamp outside league rules | Excluded from ratings | Unit tests passed locally; CI pending |
| Review | Sign in at `/review`, approve, reject, or correct a pending game | Audit decision recorded; only approved eligible games affect standings | Admin UI mock browser test passed; staging SQL integration test not run |
| Review | Retry same decision ID and payload; then retry with changed payload | First retry is a no-op; changed payload is rejected | Unit test passed locally; database SQL test awaits staging |
| Replay | Approve a late-played game and replay; repeat an import | Chronological standings are correct; duplicate import adds no game | Unit tests passed locally; CI pending |
| Replay | Five approved eligible games for one pair inside 12 hours, including reversed colours | All five games create rating events and update both ratings | Unit test passed locally; database integration check awaits applying the migration |
| Privacy | Public view and unauthenticated page | Only school-approved public data; no pending review/admin data | Not run |
| Mobile | 320px and 390px viewport, portrait | No page-level horizontal overflow | Playwright passed locally; physical devices still need checking |
| Desktop | 1280px viewport | Main headings visible; no page-level horizontal overflow | Playwright passed locally; physical computer still needs checking |
| Mobile browser engines | iPhone 13 Safari/WebKit and Pixel 7 Chrome/Chromium emulation | Leaderboard scrolls within its table; review sign-in/actions work with touch | 4 Playwright tests passed locally |
| Devices/accessibility | Physical phone/computer, keyboard and screen reader smoke test | Content, table interaction, and assistive access are usable | Manual checks still required |

**Automated checks added:** `npm test` compiles the domain TypeScript and runs
focused Node tests for Elo outcomes, result parsing/import review, eligibility,
rating replay, admin decisions, and duplicate imports. CI now runs those tests,
lint, a production build, and Playwright viewport smoke tests at 320px, 390px,
and 1280px on pushes and pull requests. Browser tests cover leaderboard data,
empty/error states, admin sign-in/authorization, decision submission, and
responsive layout. Dedicated phone tests emulate iPhone Safari (WebKit) and
Android Chrome (Chromium), including touch input on the review workflow. CI
installs both Chromium and WebKit.
Playwright is a locked development dependency. To run the browser checks
locally, install Node 22, run `npm ci`, build, install browsers with
`npx playwright install chromium webkit`, then run `npx playwright test`.

**Validation status:** locally passed with Node 22: `npm test` (11 tests),
`npm run lint`, `npm run build`, and `npx playwright test` (14 browser tests,
including iPhone Safari/WebKit and Android Chrome/Chromium emulation).
The build output includes `/`, `/review`, and the `/admin` compatibility
redirect. Push the commit and confirm
the hosted GitHub Actions CI run before treating CI as green. Run
`supabase/manual_tests/review_rpc_integration.sql` only in a staging database:
replace its admin UUID placeholder, execute the full script in Supabase SQL
Editor, and confirm it completes with `ROLLBACK`. It creates a temporary game
and verifies admin authorization, unknown-result correction, audit/rating
records, idempotent retries, payload mismatch rejection, and non-admin denial.
The database test has not been run against the hosted project. Viewport
emulation does not replace a physical-device and accessibility check.

### Prioritized backlog and owners

| Priority | Work / issue | Owner | Status / exit condition |
| --- | --- | --- | --- |
| P0 | Provision named admin accounts and deploy the admin review workflow | Person 1 + Person 2 | **Implementation added:** `/review` signs in with Supabase Auth, checks admin membership, and calls the restricted review RPC. `/admin` redirects to `/review`. Apply the new reason-required migration, provision named accounts, and verify in staging before launch. |
| P0 | Run automated domain tests and the staging database integration test | Person 2 + Person 3 | **Partially complete:** test suites and CI are added; CI has not run here and the staging RPC test remains unrun. |
| P0 | Confirm game rules, result/dispute policy, public display consent, and who can administer the league | Person 3 / organizer | **Needs school decision:** record decisions here before student launch. |
| P0 | Verify frequent imports against a known eligible game and inspect retry/conflict behavior | Person 2 | **Partially verified:** migration and Actions secrets are configured; a manual run succeeded but found 0 eligible games. Apply the frequent-sync migration and verify a scheduled run and a real eligible game before relying on imported results. |
| P1 | Verify responsive layout and accessibility on real phones/computers; exercise loading/error/empty states | Person 1 + Person 3 | **Partially complete:** automated viewport, leaderboard, and admin flow tests are added; CI and physical-device/screen-reader checks remain outstanding. |
| P1 | Add an in-repository issue list with severity, reproduction steps, owner, and resolution as bugs are found | Person 3 | **Open:** use the project issue tracker if available; do not mark launch blockers resolved without verification. |
| P2 | Add manual game entry, season/archive support, or additional formats | Organizer + team | **Not scoped:** decide only after P0 launch blockers and school rules are settled. |

**Progress check:** Person 3 coordinates one short check-in per work session:
review P0 blockers first, assign one owner and next action per open item, record
verification evidence, and update this table. The scheduled sync is configured;
keep checking its run logs, but do not rely on game imports until a known
eligible game has been observed in the database. Do not announce the website as
ready while any P0 item remains blocked.

## Frequent Chess.com import setup (Person 2)

The scheduled workflow is in `.github/workflows/daily-chesscom-sync.yml` and
server-side fetcher is `scripts/daily-chesscom-sync.mjs`. It polls the
Chess.com Published Data API for active roster accounts, uses only standard
chess with exactly 600 seconds and zero increment, and considers game end
times from 10 October 2026 00:00 Europe/London onward. It scans the current
month every five minutes (at minutes 1, 6, 11, and so on) and does a full
archive backfill daily to catch late-published games. The open leaderboard
fetches updated standings once a minute. GitHub Actions may delay or skip
scheduled runs, and Chess.com
controls when games appear in its archives, so five minutes is a best-effort
target, not a guaranteed publication time. Each run reports archive games
seen, eligible candidates, exclusion reasons, and database insert/pending/
conflict counts. Chess.com ratings are never read or used.

The workflow and external setup have been verified by a manual GitHub Actions
run on 10 October 2026 (`Daily Chess.com league sync`, run
`38076710939`). It completed successfully, checked 9 roster accounts, and
submitted 0 eligible games; the database reported 0 inserted, 0 pending, and
0 conflicts. This confirms the configured Actions credentials and import RPC
worked for that run, but does **not** confirm that any games have been
imported, that the scheduled run has succeeded, or that future syncs will
succeed.

For a new Supabase project, apply the migrations and configure Actions before
using the workflow:

1. Run `supabase/migrations/20261010190000_chesscom_daily_import.sql` once in
   Supabase SQL Editor. This exposes a narrow RPC to the backend role, stores
   import conflicts, and rebuilds a complete chronological rating replay when
   clear approved games are added.
2. Apply the same-day import migrations:
   `supabase/migrations/20261012140000_allow_frequent_chesscom_sync.sql` and
   `supabase/migrations/20261012140000_allow_same_day_import_backfills.sql`.
   They remove the daily import restriction so repeat polls can discover late
   games; unique Chess.com URLs keep re-imports safe.
3. In GitHub, open the repository's **Settings → Secrets and variables →
   Actions**, then create `SUPABASE_URL` (the project URL) and
   `SUPABASE_SECRET_KEY` (the server-only Supabase secret key). Do not use the
   publishable key for this secret and never put the secret in `.env.local`,
   `NEXT_PUBLIC_...`, or committed files. The runner sends this key only in
   the `apikey` header, as Supabase secret keys are not JWT bearer tokens.
4. Open **Actions → Chess.com league sync → Run workflow** to perform or
   retry a full backfill. Manual runs work at any time; scheduled runs poll the
   current month every five minutes and backfill all archive months daily.

Unique Chess.com game URLs and serialized database imports make retries and
overlapping workflow invocations safe. Aborted/abandoned source results are
skipped; clear checkmate outcomes are approved automatically; draws,
resignations, timeouts/possible timeouts, generic losses, and unrecognized
result codes wait in the review queue. Only approved games affect ratings.

For this project, the daily import migration and GitHub Actions secrets are
already configured, and the first manual sync completed as described above.
The organizer manually ran
`20261013162800_allow_frequent_chesscom_sync.sql` in Supabase; keep that
repeat-import database change when deploying. Use **Actions → Chess.com league
sync → Run workflow** to retry or backfill. Check each run's log for
`archiveGamesSeen`, `eligibleRecordsSeen`, `excludedGames`,
`uniqueGamesSubmitted`, and database `inserted`, `pending`, and `conflicts`
counts. A successful run with zero eligible games means only that it submitted
no games on that poll; it does not prove no recent eligible games exist.
