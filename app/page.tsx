import { demoRatingReplay, registeredPlayers } from "@/league";

const usernamesByPlayerId = new Map(
  registeredPlayers.map((player) => [player.id, player.chessComUsername]),
);

export default function Home() {
  return (
    <main className="page-shell">
      <header className="page-header">
        <p className="eyebrow">School year group</p>
        <h1>Chess League</h1>
        <p className="intro">
          Everyone starts at 1000. No games have been recorded yet.
        </p>
      </header>
      <section aria-labelledby="leaderboard-heading" className="leaderboard">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Season one</p>
            <h2 id="leaderboard-heading">Leaderboard</h2>
          </div>
          <p className="rating-note">Starting rating: 1000</p>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Player</th>
                <th scope="col">Chess.com username</th>
                <th scope="col">League Elo</th>
                <th scope="col">Games</th>
              </tr>
            </thead>
            <tbody>
              {demoRatingReplay.standings.map((player, index) => (
                <tr key={player.playerId}>
                  <td>{player.gamesPlayed === 0 ? "—" : index + 1}</td>
                  <th scope="row">{player.displayName}</th>
                  <td>{usernamesByPlayerId.get(player.playerId) ?? "—"}</td>
                  <td>{player.rating}</td>
                  <td>{player.gamesPlayed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <footer>
        Ratings shown here are local league ratings, independent of Chess.com
        ratings.
      </footer>
    </main>
  );
}
