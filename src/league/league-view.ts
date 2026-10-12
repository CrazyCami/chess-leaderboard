/**
 * Pure helpers for the public league pages. Everything here works on the rows
 * the Supabase Data API returns, so it can be unit-tested without a browser.
 */

export type PlayerResult = "win" | "draw" | "loss";
export type GameResult = "white_win" | "draw" | "black_win";

/** One row of the public `leaderboard` view. */
export interface LeaderboardEntry {
  player_id: string;
  display_name: string;
  chesscom_username: string | null;
  rating: number;
  wins: number;
  draws: number;
  losses: number;
  games_played: number;
}

/** One row of `rating_events` for the current replay. */
export interface RatingEventRow {
  game_id: string;
  player_id: string;
  opponent_id: string;
  played_at: string;
  result: PlayerResult;
  rating_before: number;
  rating_change: number;
  rating_after: number;
}

/** One approved row of `games`. */
export interface ApprovedGameRow {
  id: string;
  white_player_id: string;
  black_player_id: string;
  result: GameResult | null;
  played_at: string;
  source_game_url: string | null;
}

export interface RatingPoint {
  /** Milliseconds since the epoch. */
  time: number;
  rating: number;
  /** Absent on the synthetic starting point. */
  gameId?: string;
  change?: number;
  result?: PlayerResult;
}

export interface RatingSeries {
  playerId: string;
  points: RatingPoint[];
}

/** Rank active players (at least one rated game) in the order the view returns them. */
export function rankActivePlayers(entries: readonly LeaderboardEntry[]): Map<string, number> {
  const ranks = new Map<string, number>();
  let rank = 0;
  for (const entry of entries) {
    if (entry.games_played > 0) ranks.set(entry.player_id, ++rank);
  }
  return ranks;
}

/** Displayed ratings are rounded to the nearest whole point; rankings are not. */
export function formatRating(rating: number): string {
  return String(Math.round(rating));
}

/** Signed whole-point change, using a real minus sign. */
export function formatChange(change: number): string {
  const rounded = Math.round(change);
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return "0";
}

/** Scoresheet notation from White's point of view. */
export function resultNotation(result: GameResult | null): string {
  switch (result) {
    case "white_win":
      return "1–0";
    case "black_win":
      return "0–1";
    case "draw":
      return "½–½";
    default:
      return "?";
  }
}

export function resultLetter(result: PlayerResult): "W" | "D" | "L" {
  return result === "win" ? "W" : result === "draw" ? "D" : "L";
}

/** Group a player's rating events in chronological order. */
export function eventsByPlayer(events: readonly RatingEventRow[]): Map<string, RatingEventRow[]> {
  const sorted = [...events].sort(compareEvents);
  const grouped = new Map<string, RatingEventRow[]>();
  for (const event of sorted) {
    const list = grouped.get(event.player_id);
    if (list) list.push(event);
    else grouped.set(event.player_id, [event]);
  }
  return grouped;
}

function compareEvents(left: RatingEventRow, right: RatingEventRow): number {
  const byTime = Date.parse(left.played_at) - Date.parse(right.played_at);
  if (byTime !== 0) return byTime;
  return left.game_id < right.game_id ? -1 : left.game_id > right.game_id ? 1 : 0;
}

/** How far before the league's first game each curve starts, so the opening segment has a slope. */
export const SERIES_LEAD_IN_MS = 30 * 60 * 1000;

/**
 * Build one rating curve per player. Each curve starts with a synthetic point
 * at the player's rating before their first game, placed just before the
 * league's first game so every curve shares the same origin.
 */
export function buildRatingSeries(events: readonly RatingEventRow[]): RatingSeries[] {
  const grouped = eventsByPlayer(events);
  if (grouped.size === 0) return [];
  const leagueStart = Math.min(...events.map((event) => Date.parse(event.played_at))) - SERIES_LEAD_IN_MS;
  const series: RatingSeries[] = [];
  for (const [playerId, playerEvents] of grouped) {
    const points: RatingPoint[] = [{ time: leagueStart, rating: playerEvents[0].rating_before }];
    for (const event of playerEvents) {
      points.push({
        time: Date.parse(event.played_at),
        rating: event.rating_after,
        gameId: event.game_id,
        change: event.rating_change,
        result: event.result,
      });
    }
    series.push({ playerId, points });
  }
  return series;
}

/** Net rating change over a player's most recent `count` rated games. */
export function recentChange(playerEvents: readonly RatingEventRow[], count = 5): number {
  return playerEvents.slice(-count).reduce((total, event) => total + event.rating_change, 0);
}

/** The player's most recent results, oldest first, as W/D/L letters. */
export function recentForm(playerEvents: readonly RatingEventRow[], count = 5): ("W" | "D" | "L")[] {
  return playerEvents.slice(-count).map((event) => resultLetter(event.result));
}

/** Round-number axis ticks that bracket the data. */
export function niceTicks(min: number, max: number, targetCount = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) {
    min -= 25;
    max += 25;
  }
  const rawStep = (max - min) / Math.max(1, targetCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const factor = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  const step = factor * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toFixed(6)));
  }
  return ticks;
}

export const SERIES_SLOT_COUNT = 8;

/**
 * Keep chart colours attached to players, not to their rank. A player keeps
 * the slot they were first given; a newly shown player takes the lowest free
 * slot; hidden players release theirs.
 */
export function assignSeriesSlots(
  previous: ReadonlyMap<string, number>,
  shown: readonly string[],
): Map<string, number> {
  const next = new Map<string, number>();
  for (const playerId of shown) {
    const slot = previous.get(playerId);
    if (slot !== undefined) next.set(playerId, slot);
  }
  const used = new Set(next.values());
  for (const playerId of shown) {
    if (next.has(playerId)) continue;
    let slot = 0;
    while (used.has(slot)) slot += 1;
    if (slot >= SERIES_SLOT_COUNT) break;
    next.set(playerId, slot);
    used.add(slot);
  }
  return next;
}

export function chessComProfileUrl(username: string): string {
  return `https://www.chess.com/member/${encodeURIComponent(username)}`;
}

const dayFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

export function formatDay(value: string | number): string {
  return dayFormatter.format(new Date(value));
}

export function formatTime(value: string | number): string {
  return timeFormatter.format(new Date(value));
}

export function formatDateTime(value: string | number): string {
  return dateTimeFormatter.format(new Date(value));
}
