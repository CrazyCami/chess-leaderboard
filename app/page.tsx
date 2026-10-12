import Link from "next/link";
import { Masthead } from "./Masthead";
import { LeagueDashboard } from "@/league/LeagueDashboard";

export default function Home() {
  return (
    <main className="page-shell">
      <Masthead eyebrow="School year group · Season one" title="Chess League">
        Friends, ten-minute games on Chess.com, one rating table. League Elo is
        worked out from approved games only and is independent of Chess.com ratings.
      </Masthead>
      <LeagueDashboard />
      <footer className="page-footer">
        <div>
          <h2>How ratings work</h2>
          <p>
            After each approved game the winner takes points from the loser,
            scaled by how surprising the result was. A win scores 1, a draw ½,
            a loss 0. Only games between registered players, played from
            10 October 2026, count. Abandoned games are ignored.
          </p>
        </div>
        <div>
          <h2>Results</h2>
          <p>
            Checkmates and resignations are counted automatically. Draws,
            timeouts and unclear results wait for an organiser to check them.
          </p>
          <p><Link href="/review">Review games</Link></p>
        </div>
      </footer>
    </main>
  );
}
