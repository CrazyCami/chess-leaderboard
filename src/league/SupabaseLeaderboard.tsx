"use client";

import { useEffect, useState } from "react";

type LeaderboardEntry = {
  player_id: string;
  display_name: string;
  chesscom_username: string | null;
  rating: number;
  wins: number;
  draws: number;
  losses: number;
  games_played: number;
};

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function SupabaseLeaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectUrl || !publishableKey) return;

    const controller = new AbortController();

    async function loadLeaderboard() {
      try {
        const response = await fetch(
          `${projectUrl}/rest/v1/leaderboard?select=player_id,display_name,chesscom_username,rating,wins,draws,losses,games_played&order=rating.desc,display_name.asc`,
          {
            headers: { apikey: publishableKey! },
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error(`Supabase returned HTTP ${response.status}.`);
        }

        const leaderboard = (await response.json()) as LeaderboardEntry[];
        leaderboard.sort((a, b) => {
          const playedComparison = Number(b.games_played > 0) - Number(a.games_played > 0);
          if (playedComparison !== 0) return playedComparison;

          return b.rating - a.rating || a.display_name.localeCompare(b.display_name);
        });
        setEntries(leaderboard);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Could not load leaderboard.",
        );
      }
    }

    void loadLeaderboard();
    return () => controller.abort();
  }, []);

  const configured = Boolean(projectUrl && publishableKey);
  const rankByPlayerId = new Map<string, number>(
    (entries ?? [])
      .filter((player) => player.games_played > 0)
      .map((player, index): [string, number] => [player.player_id, index + 1]),
  );

  return (
    <section aria-labelledby="leaderboard-heading" className="leaderboard">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Season one</p>
          <h2 id="leaderboard-heading">Leaderboard</h2>
        </div>
        <p className="rating-note">Starting rating: 1000</p>
      </div>
      {!configured ? (
        <p className="connection-message">
          Add the Supabase project URL and publishable key to <code>.env.local</code>
          to show the database leaderboard.
        </p>
      ) : error ? (
        <p className="connection-message" role="alert">
          Could not load the leaderboard: {error}
        </p>
      ) : entries === null ? (
        <p className="connection-message" role="status">
          Loading leaderboard…
        </p>
      ) : entries.length === 0 ? (
        <p className="connection-message">No active players found.</p>
      ) : (
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
              {entries.map((player) => (
                <tr key={player.player_id}>
                  <td>{rankByPlayerId.get(player.player_id) ?? "—"}</td>
                  <th scope="row">{player.display_name}</th>
                  <td>{player.chesscom_username ?? "—"}</td>
                  <td>{Math.round(player.rating)}</td>
                  <td>{player.games_played}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
