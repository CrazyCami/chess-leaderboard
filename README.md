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

## Daily Chess.com import setup (Person 2)

The daily workflow is in `.github/workflows/daily-chesscom-sync.yml` and its
server-side fetcher is `scripts/daily-chesscom-sync.mjs`. It polls the
Chess.com Published Data API for active roster accounts, uses only standard
chess with exactly 600 seconds and zero increment, and considers game end
times from 10 October 2026 00:00 Europe/London onward. Chess.com ratings are
never read or used.

Before enabling the workflow:

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

The migration and GitHub secrets are not yet configured by this repository
change, so no live Chess.com records are fetched until you complete these
steps and run the workflow.
