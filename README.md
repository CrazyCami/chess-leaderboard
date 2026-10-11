# School Chess League

A Next.js and TypeScript school year-group chess league. The leaderboard can read active player standings from the Supabase `leaderboard` view using a public publishable key and database row-level security (RLS).

## Run locally

1. Install Node.js (20.9 or newer) and npm.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`, then set the Supabase project URL and publishable key from your Supabase project’s Connect dialog.
4. Run `npm run dev`.
5. Open [http://localhost:3000](http://localhost:3000).

The public page reads standings from Supabase. Admin sign-in and the review interface are not built yet. Never use a Supabase secret key in a `NEXT_PUBLIC_` variable. Keep `.env.local` private; Git ignores it.

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
  (`standard-elo-v1`) with K-factor 32. Ratings are unrounded in storage and
  replay, and displayed to the nearest whole point. Rankings use the unrounded
  rating. Chess.com ratings do not affect league ratings. Games are replayed
  chronologically, with game ID as the stable tie-breaker; late approvals can
  therefore change later results.
- **Outcomes:** a win scores 1, a draw 0.5, and a loss 0. The winning player's
  score is paired with the opponent's complementary score. A game is not
  counted until approved.
- **League scope:** there is no separate season reset or inactivity penalty in
  the current implementation. Do not promise either until the school has
  agreed a policy and it has been implemented.

### Questionable-game approval

The import automatically approves only a recognized decisive checkmate.
Draws, resignations, timeouts, generic losses, uncertain or unknown result
codes are pending. Abandoned/aborted games are ignored. Pending and rejected
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
   gather evidence, and have an admin review it. The website has no sign-in or
   review screen yet, so **do not treat this as an available in-site process**:
   use a school-approved, access-controlled channel and a designated admin
   until the interface and account provisioning are delivered.

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
| Ratings | White wins from equal 1000 ratings, K=32 | White 1016, Black 984 | Unit test added; CI pending |
| Ratings | Black wins from equal 1000 ratings, K=32 | White 984, Black 1016 | Unit test added; CI pending |
| Ratings | Draw from equal 1000 ratings, K=32 | Both remain 1000 | Unit test added; CI pending |
| Results | Recognized checkmate win/loss pair | Correct winner; eligible for auto-approval | Unit test added; CI pending |
| Results | Agreed draw, stalemate, repetition, insufficient material, 50-move draw | Draw; pending admin review | Unit tests added; CI pending |
| Results | Resignation or timeout with a winner | Correct winner; pending admin review | Unit tests added; CI pending |
| Results | Abandoned/aborted game | Ignored; no rating change | Unit test added; CI pending |
| Results | Unknown, conflicting, or malformed result pair | Pending; cannot approve without correction | Partially covered; CI pending |
| Eligibility | Variant, time control, date, player, or timestamp outside league rules | Excluded from ratings | Unit tests added; CI pending |
| Review | Approve, reject, and correct a pending game | Audit decision recorded; only approved eligible games affect standings | Decision logic unit tests added; database integration not covered |
| Review | Retry same decision ID and payload; then retry with changed payload | First retry is a no-op; changed payload is rejected | Unit test added; CI pending |
| Replay | Approve a late-played game and replay; repeat an import | Chronological standings are correct; duplicate import adds no game | Replay and duplicate-import unit tests added; CI pending |
| Privacy | Public view and unauthenticated page | Only school-approved public data; no pending review/admin data | Not run |
| Mobile | 320px and 390px viewport, portrait | No page-level horizontal overflow | Playwright viewport tests added; CI pending |
| Desktop | 1280px viewport | Main headings visible; no page-level horizontal overflow | Playwright viewport test added; CI pending |
| Devices/accessibility | Physical phone/computer, keyboard and screen reader smoke test | Content, table interaction, and assistive access are usable | Manual checks still required |

**Automated checks added:** `npm test` compiles the domain TypeScript and runs
focused Node tests for Elo outcomes, result parsing/import review, eligibility,
rating replay, admin decisions, and duplicate imports. CI now runs those tests,
lint, a production build, and Playwright viewport smoke tests at 320px, 390px,
and 1280px on pushes and pull requests. The Playwright runner is installed in
CI; to run those browser checks locally, install Node 22 dependencies and build,
then run `npm install --no-save --package-lock=false
@playwright/test@1.55.0`, `npx playwright install chromium`, and
`npx playwright test`.

**Validation status:** these checks are newly added, not yet executed in this
environment because Node/npm are unavailable here. CI must pass before treating
automated checks as green. Viewport emulation does not replace a physical-device
and accessibility check.

### Prioritized backlog and owners

| Priority | Work / issue | Owner | Status / exit condition |
| --- | --- | --- | --- |
| P0 | Provision named admin accounts and deliver sign-in, pending-game queue, evidence/reason fields, approve/reject/correct actions, and decision feedback | Person 1 + Person 2 | **Blocked:** database RPC exists, but no login or review UI. Admin can review a questionable game without exposing privileged credentials. |
| P0 | Run automated domain tests and add database integration coverage for the acceptance cases above | Person 2 + Person 3 | **Partially complete:** focused domain tests and CI are added; CI has not run here, and persisted review/RPC behavior still needs database integration tests. |
| P0 | Confirm game rules, result/dispute policy, public display consent, and who can administer the league | Person 3 / organizer | **Needs school decision:** record decisions here before student launch. |
| P0 | Verify daily imports against a known eligible game and inspect retry/conflict behavior | Person 2 | **Partially verified:** migration and Actions secrets are configured; a manual run succeeded but found 0 eligible games. Verify a scheduled run and a real eligible game before relying on imported results. |
| P1 | Verify responsive layout and accessibility on real phones/computers; exercise loading/error/empty states | Person 1 + Person 3 | **Partially complete:** automated viewport smoke tests are added; CI and physical-device/accessibility checks remain outstanding. |
| P1 | Add an in-repository issue list with severity, reproduction steps, owner, and resolution as bugs are found | Person 3 | **Open:** use the project issue tracker if available; do not mark launch blockers resolved without verification. |
| P2 | Add manual game entry, season/archive support, or additional formats | Organizer + team | **Not scoped:** decide only after P0 launch blockers and school rules are settled. |

**Progress check:** Person 3 coordinates one short check-in per work session:
review P0 blockers first, assign one owner and next action per open item, record
verification evidence, and update this table. The scheduled sync is configured;
keep checking its run logs, but do not rely on game imports until a known
eligible game has been observed in the database. Do not announce the website as
ready while any P0 item remains blocked.

## Daily Chess.com import setup (Person 2)

The daily workflow is in `.github/workflows/daily-chesscom-sync.yml` and its
server-side fetcher is `scripts/daily-chesscom-sync.mjs`. It polls the
Chess.com Published Data API for active roster accounts, uses only standard
chess with exactly 600 seconds and zero increment, and considers game end
times from 10 October 2026 00:00 Europe/London onward. Chess.com ratings are
never read or used.

The workflow and external setup have been verified by a manual GitHub Actions
run on 10 October 2026 (`Daily Chess.com league sync`, run
`38076710939`). It completed successfully, checked 9 roster accounts, and
submitted 0 eligible games; the database reported 0 inserted, 0 pending, and
0 conflicts. This confirms the configured Actions credentials and import RPC
worked for that run, but does **not** confirm that any games have been
imported, that the scheduled run has succeeded, or that future syncs will
succeed.

For a new Supabase project, apply the migration and configure Actions before
using the workflow:

1. Run `supabase/migrations/20261010190000_chesscom_daily_import.sql` once in
   Supabase SQL Editor. This exposes a narrow RPC to the backend role, stores
   import conflicts, and rebuilds a complete chronological rating replay when
   clear approved games are added.
2. In GitHub, open the repository's **Settings → Secrets and variables →
   Actions**, then create `SUPABASE_URL` (the project URL) and
   `SUPABASE_SECRET_KEY` (the server-only Supabase secret key). Do not use the
   publishable key for this secret and never put the secret in `.env.local`,
   `NEXT_PUBLIC_...`, or committed files. The runner sends this key only in
   the `apikey` header, as Supabase secret keys are not JWT bearer tokens.
3. Open **Actions → Daily Chess.com league sync → Run workflow** to perform the
   first import. Manual runs work at any time. Later runs are scheduled for
   the 16:00 London window; GitHub schedules are UTC-based and can be delayed,
   so the workflow has a one-hour recovery window and retries missed archive
   data on subsequent daily polls.

The first sync scans monthly archives from October 2026 through the current
month. Later syncs continue rescanning that range so cached/late-published
games can be picked up. A unique Chess.com game URL and a London-calendar-date
lock make retries and overlapping workflow invocations safe. Aborted/abandoned
source results are skipped; clear checkmate outcomes are approved automatically;
draws, resignations, timeouts/possible timeouts, generic losses, and unrecognized
result codes wait in the review queue. Only approved games affect ratings.

For this project, the daily import migration and GitHub Actions secrets are
already configured, and the first manual sync completed as described above.
Use **Actions → Daily Chess.com league sync → Run workflow** to retry or
backfill. Check each run's log for `eligibleRecordsSeen`, `uniqueGamesSubmitted`,
and the database `inserted`, `pending`, and `conflicts` counts. Investigate a
failed run or any conflict before relying on its data. A zero-game successful
run means only that no eligible games were submitted by that run; it is not
evidence that the full school league workflow or admin review interface is
ready.
