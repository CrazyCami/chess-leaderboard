import { SupabaseLeaderboard } from "@/league/SupabaseLeaderboard";

export default function Home() {
  return (
    <main className="page-shell">
      <header className="page-header">
        <p className="eyebrow">School year group</p>
        <h1>Chess League</h1>
        <p className="intro">
          League ratings are calculated independently of Chess.com ratings.
        </p>
      </header>
      <SupabaseLeaderboard />
      <footer>
        Ratings shown here are local league ratings, independent of Chess.com
        ratings.
      </footer>
    </main>
  );
}
