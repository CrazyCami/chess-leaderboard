# School Chess League

A Next.js and TypeScript school year-group chess league. The leaderboard can read active player standings from the Supabase `leaderboard` view using a public publishable key and database row-level security (RLS).

## Run locally

1. Install Node.js (20.9 or newer) and npm.
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`, then set the Supabase project URL and publishable key from your Supabase project’s Connect dialog.
4. Run `npm run dev`.
5. Open [http://localhost:3000](http://localhost:3000).

This first read connection only fetches the public leaderboard. There is no authentication, write access, Chess.com importer, game history, or rating processor yet. Never use a Supabase secret/service-role key in a `NEXT_PUBLIC_` variable. Keep `.env.local` private; Git ignores it.

## Team roles

- Person 1 owns the website interface and visual design.
- Person 2 owns backend logic, the database, imports, duplicate prevention, and ratings.
- Person 3 owns league rules, review-process decisions, and QA.

Use fictional data while developing features. Public student names/usernames should only be loaded after the league agrees to publish them. Privileged credentials must stay server-side and must never use a `NEXT_PUBLIC_` environment variable.
