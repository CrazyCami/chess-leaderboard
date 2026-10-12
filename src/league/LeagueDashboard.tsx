"use client";

import { useEffect, useMemo, useState } from "react";
import { RatingChart } from "./RatingChart";
import {
  assignSeriesSlots,
  buildRatingSeries,
  chessComProfileUrl,
  eventsByPlayer,
  formatChange,
  formatDateTime,
  formatRating,
  rankActivePlayers,
  recentChange,
  recentForm,
  resultNotation,
  SERIES_SLOT_COUNT,
  type ApprovedGameRow,
  type LeaderboardEntry,
  type RatingEventRow,
  type RatingSeries,
} from "./league-view";

type SettingsRow = { initial_rating: number; k_factor: number };
type ReplayRow = { id: string; created_at: string; initial_rating: number; k_factor: number };

type HistoryData = {
  replayCreatedAt: string | null;
  initialRating: number;
  kFactor: number;
  events: RatingEventRow[];
  games: ApprovedGameRow[];
};

type HistoryState =
  | { status: "loading" }
  | { status: "ready"; data: HistoryData }
  | { status: "error"; message: string };

const DEFAULT_SHOWN_SERIES = 6;
const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function fetchRows<T>(path: string, signal: AbortSignal): Promise<T[]> {
  const response = await fetch(`${projectUrl}${path}`, {
    headers: { apikey: publishableKey! },
    signal,
  });
  if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}.`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error("Supabase returned an unexpected response.");
  return rows as T[];
}

export function LeagueDashboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryState>({ status: "loading" });
  const [shown, setShown] = useState<string[] | null>(null);
  const [slots, setSlots] = useState<Map<string, number>>(() => new Map());

  const configured = Boolean(projectUrl && publishableKey);

  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();

    async function loadLeaderboard() {
      try {
        const rows = await fetchRows<LeaderboardEntry>(
          "/rest/v1/leaderboard?select=player_id,display_name,chesscom_username,rating,wins,draws,losses,games_played&order=rating.desc,display_name.asc",
          controller.signal,
        );
        setEntries(rows);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Could not load leaderboard.");
      }
    }

    async function loadHistory() {
      try {
        const [settings, replays, games] = await Promise.all([
          fetchRows<SettingsRow>("/rest/v1/league_settings?select=initial_rating,k_factor&singleton=eq.true", controller.signal),
          fetchRows<ReplayRow>("/rest/v1/rating_replays?select=id,created_at,initial_rating,k_factor&order=replay_generation.desc&limit=1", controller.signal),
          fetchRows<ApprovedGameRow>(
            "/rest/v1/games?select=id,white_player_id,black_player_id,result,played_at,source_game_url&review_status=eq.approved&order=played_at.desc,id.desc&limit=8",
            controller.signal,
          ),
        ]);
        const replay = replays[0] ?? null;
        const events = replay
          ? await fetchRows<RatingEventRow>(
            `/rest/v1/rating_events?select=game_id,player_id,opponent_id,played_at,result,rating_before,rating_change,rating_after&replay_id=eq.${encodeURIComponent(replay.id)}&order=played_at.asc,game_id.asc`,
            controller.signal,
          )
          : [];
        setHistory({
          status: "ready",
          data: {
            replayCreatedAt: replay?.created_at ?? null,
            initialRating: Number(replay?.initial_rating ?? settings[0]?.initial_rating ?? 1000),
            kFactor: Number(replay?.k_factor ?? settings[0]?.k_factor ?? 32),
            events,
            games,
          },
        });
      } catch (cause) {
        if (controller.signal.aborted) return;
        setHistory({ status: "error", message: cause instanceof Error ? cause.message : "Could not load rating history." });
      }
    }

    void loadLeaderboard();
    void loadHistory();
    return () => controller.abort();
  }, [configured]);

  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries ?? []) map.set(entry.player_id, entry.display_name);
    return map;
  }, [entries]);
  const nameOf = (playerId: string) => names.get(playerId) ?? playerId;

  const historyData = history.status === "ready" ? history.data : null;
  const playerEvents = useMemo(() => eventsByPlayer(historyData?.events ?? []), [historyData]);
  const series = useMemo(() => buildRatingSeries(historyData?.events ?? []), [historyData]);
  const seriesById = useMemo(() => new Map(series.map((item) => [item.playerId, item])), [series]);
  const ratedGameCount = historyData ? new Set(historyData.events.map((event) => event.game_id)).size : null;

  useEffect(() => {
    if (!historyData || shown !== null) return;
    const byRating = [...series].sort(
      (left, right) => right.points[right.points.length - 1].rating - left.points[left.points.length - 1].rating,
    );
    const initial = byRating.slice(0, DEFAULT_SHOWN_SERIES).map((item) => item.playerId);
    setShown(initial);
    setSlots(assignSeriesSlots(new Map(), initial));
  }, [historyData, series, shown]);

  function toggleSeries(playerId: string) {
    const current = shown ?? [];
    const next = current.includes(playerId)
      ? current.filter((id) => id !== playerId)
      : [...current, playerId];
    setShown(next);
    setSlots((previous) => assignSeriesSlots(previous, next));
  }

  const shownSeries: (RatingSeries & { slot: number })[] = (shown ?? [])
    .flatMap((playerId) => {
      const item = seriesById.get(playerId);
      const slot = slots.get(playerId);
      return item && slot !== undefined ? [{ ...item, slot }] : [];
    });

  // The view orders by rating alone; show players with rated games first so a
  // 999-rated player is not buried under everyone still on the starting rating.
  const orderedEntries = [...(entries ?? [])].sort(
    (left, right) => Number(right.games_played > 0) - Number(left.games_played > 0),
  );
  const ranks = rankActivePlayers(orderedEntries);
  const eventsForGame = (gameId: string) => (historyData?.events ?? []).filter((event) => event.game_id === gameId);

  return (
    <>
      <ul className="facts" aria-label="League facts">
        {entries && <li><span className="fact-value">{entries.length}</span><span className="fact-label">players</span></li>}
        {ratedGameCount !== null && <li><span className="fact-value">{ratedGameCount}</span><span className="fact-label">rated games</span></li>}
      </ul>

      <section aria-labelledby="leaderboard-heading" className="leaderboard">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Season one</p>
            <h2 id="leaderboard-heading">Leaderboard</h2>
          </div>
          <p className="rating-note">
            {historyData?.replayCreatedAt
              ? `Standings as of ${formatDateTime(historyData.replayCreatedAt)}`
              : "Ratings move only with approved games"}
          </p>
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
            <table className="standings">
              <thead>
                <tr>
                  <th scope="col" className="col-rank">Rank</th>
                  <th scope="col">Player</th>
                  <th scope="col" className="col-num">League Elo</th>
                  <th scope="col">Record</th>
                  <th scope="col" className="col-num">Games</th>
                  <th scope="col">Form</th>
                  <th scope="col">Last 5</th>
                </tr>
              </thead>
              <tbody>
                {orderedEntries.map((player) => {
                  const rank = ranks.get(player.player_id);
                  const events = playerEvents.get(player.player_id) ?? [];
                  const form = recentForm(events);
                  const change = recentChange(events);
                  const sparkPoints = seriesById.get(player.player_id)?.points.slice(-10) ?? [];
                  return (
                    <tr key={player.player_id} className={rank === undefined ? "unrated" : undefined}>
                      <td className="col-rank" data-place={rank !== undefined && rank <= 3 ? rank : undefined}>{rank ?? "—"}</td>
                      <th scope="row">
                        <span className="player-name">{player.display_name}</span>
                        {player.chesscom_username && (
                          <a className="player-handle" href={chessComProfileUrl(player.chesscom_username)} target="_blank" rel="noreferrer">
                            {player.chesscom_username}
                          </a>
                        )}
                      </th>
                      <td className="col-num rating">{formatRating(player.rating)}</td>
                      <td>
                        <span className="record">
                          <span className="record-text">
                            {player.wins}–{player.draws}–{player.losses}
                          </span>
                          {player.games_played > 0 && (
                            <span className="record-bar" aria-hidden="true">
                              <span className="record-win" style={{ flexGrow: player.wins }} />
                              <span className="record-draw" style={{ flexGrow: player.draws }} />
                              <span className="record-loss" style={{ flexGrow: player.losses }} />
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="col-num">{player.games_played}</td>
                      <td>
                        {form.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <span className="form" aria-label={`Recent results: ${form.join(", ")}`}>
                            {form.map((letter, index) => (
                              <span key={index} className={`form-${letter}`} aria-hidden="true">{letter}</span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td>
                        {events.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <span className="trend">
                            <Sparkline points={sparkPoints.map((point) => point.rating)} />
                            <span className={`delta ${change > 0 ? "delta-up" : change < 0 ? "delta-down" : ""}`}>
                              {formatChange(change)}
                            </span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="detail-grid">
        <section className="panel chart-panel" aria-labelledby="history-heading">
          <div className="panel-heading">
            <h2 id="history-heading">Rating history</h2>
            {series.length > 0 && (
              <p className="panel-note">Tap a name to show or hide it. Up to {SERIES_SLOT_COUNT} at once.</p>
            )}
          </div>
          {history.status === "loading" ? (
            <div className="panel-placeholder" aria-busy="true">Loading rating history…</div>
          ) : history.status === "error" ? (
            <p className="panel-placeholder">Rating history is unavailable right now. {history.message}</p>
          ) : series.length === 0 ? (
            <div className="panel-placeholder empty-chart">
              <p className="empty-title">No rated games yet</p>
              <p>Rating curves appear here once approved games have been imported.</p>
            </div>
          ) : (
            <>
              <div className="legend" role="group" aria-label="Players shown on the chart">
                {series.map((item) => {
                  const slot = slots.get(item.playerId);
                  const active = slot !== undefined && (shown ?? []).includes(item.playerId);
                  const full = !active && (shown ?? []).length >= SERIES_SLOT_COUNT;
                  return (
                    <button
                      key={item.playerId}
                      type="button"
                      className="legend-chip"
                      aria-pressed={active}
                      disabled={full}
                      onClick={() => toggleSeries(item.playerId)}
                      style={active ? { ["--chip" as string]: `var(--series-${slot})` } : undefined}
                    >
                      <span className="legend-swatch" aria-hidden="true" />
                      {nameOf(item.playerId)}
                    </button>
                  );
                })}
              </div>
              <RatingChart series={shownSeries} names={names} initialRating={historyData!.initialRating} />
              <details className="game-log">
                <summary>Game log as a table</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Played</th>
                        <th scope="col">Player</th>
                        <th scope="col">Opponent</th>
                        <th scope="col">Result</th>
                        <th scope="col" className="col-num">Change</th>
                        <th scope="col" className="col-num">Rating</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...historyData!.events].reverse().slice(0, 60).map((event) => (
                        <tr key={`${event.game_id}-${event.player_id}`}>
                          <td>{formatDateTime(event.played_at)}</td>
                          <td>{nameOf(event.player_id)}</td>
                          <td>{nameOf(event.opponent_id)}</td>
                          <td>{event.result}</td>
                          <td className="col-num">{formatChange(event.rating_change)}</td>
                          <td className="col-num">{formatRating(event.rating_after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </section>

        <section className="panel games-panel" aria-labelledby="games-heading">
          <div className="panel-heading">
            <h2 id="games-heading">Recent games</h2>
            <p className="panel-note">White is listed first.</p>
          </div>
          {history.status === "loading" ? (
            <div className="panel-placeholder" aria-busy="true">Loading games…</div>
          ) : history.status === "error" ? (
            <p className="panel-placeholder">Games are unavailable right now.</p>
          ) : historyData!.games.length === 0 ? (
            <div className="panel-placeholder empty-chart">
              <p className="empty-title">Nothing on the scoresheet</p>
              <p>Approved games played on or after 10 October 2026 show up here.</p>
            </div>
          ) : (
            <ol className="game-list">
              {historyData!.games.map((game) => {
                const gameEvents = eventsForGame(game.id);
                const whiteEvent = gameEvents.find((event) => event.player_id === game.white_player_id);
                const blackEvent = gameEvents.find((event) => event.player_id === game.black_player_id);
                return (
                  <li key={game.id}>
                    <time dateTime={game.played_at}>{formatDateTime(game.played_at)}</time>
                    <span className="pairing">
                      <span className="side side-white">{nameOf(game.white_player_id)}</span>
                      <span className="score">{resultNotation(game.result)}</span>
                      <span className="side side-black">{nameOf(game.black_player_id)}</span>
                    </span>
                    {whiteEvent && blackEvent && (
                      <span className="pair-delta">
                        <span className={whiteEvent.rating_change >= 0 ? "delta-up" : "delta-down"}>{formatChange(whiteEvent.rating_change)}</span>
                        <span className={blackEvent.rating_change >= 0 ? "delta-up" : "delta-down"}>{formatChange(blackEvent.rating_change)}</span>
                      </span>
                    )}
                    {game.source_game_url && (
                      <a className="game-link" href={game.source_game_url} target="_blank" rel="noreferrer">Chess.com</a>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const width = 72;
  const height = 22;
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (width - 4) / (points.length - 1);
  const coords = points.map((value, index) => [2 + index * step, 2 + (height - 4) * (1 - (value - min) / span)]);
  const path = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="currentColor" />
    </svg>
  );
}
