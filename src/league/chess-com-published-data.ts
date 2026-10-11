import {
  isAbortedChessComResult,
  needsChessComHumanReview,
  parseChessComResult,
} from "./chess-com-result";
import type { GameResult } from "./elo";
import { isLeagueTimeControl } from "./eligibility";

export interface ImportRosterPlayer {
  id: string;
  chesscom_username: string | null;
}

export interface ChessComImportCandidate {
  source_game_url: string;
  white_player_id: string;
  black_player_id: string;
  result: GameResult | null;
  white_source_result: string;
  black_source_result: string;
  played_at: string;
  time_control: string;
  rules: "chess";
  review_status: "pending" | "approved";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Convert a London calendar date's midnight to a UTC Unix timestamp. */
export function londonDateStartEpoch(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("Import start date must be YYYY-MM-DD.");
  const [, year, month, day] = match;
  const targetWallTime = Date.UTC(Number(year), Number(month) - 1, Number(day));
  let guess = targetWallTime;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // Correct the UTC guess by the difference between its London wall clock
  // and the target local midnight. Two passes cover both GMT and BST dates.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).map(({ type, value }) => [type, value]),
    );
    const displayedWallTime = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    guess += targetWallTime - displayedWallTime;
  }

  return Math.floor(guess / 1000);
}

/** Normalize one Published Data API archive item; irrelevant games return null. */
export function normalizeChessComArchiveGame(
  input: unknown,
  roster: readonly ImportRosterPlayer[],
  cutoffEpochSeconds: number,
): ChessComImportCandidate | null {
  const game = asRecord(input);
  const white = asRecord(game?.white);
  const black = asRecord(game?.black);
  if (!game || !white || !black) return null;

  const usernameToId = new Map(
    roster
      .filter((player) => player.chesscom_username)
      .map((player) => [player.chesscom_username!.toLocaleLowerCase("en-US"), player.id]),
  );
  const whiteUsername = typeof white.username === "string" ? white.username : "";
  const blackUsername = typeof black.username === "string" ? black.username : "";
  const whitePlayerId = usernameToId.get(whiteUsername.toLocaleLowerCase("en-US"));
  const blackPlayerId = usernameToId.get(blackUsername.toLocaleLowerCase("en-US"));
  if (!whitePlayerId || !blackPlayerId || whitePlayerId === blackPlayerId) return null;

  const sourceGameUrl = typeof game.url === "string" ? game.url : "";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sourceGameUrl);
  } catch {
    return null;
  }
  if (
    parsedUrl.protocol !== "https:" ||
    !["chess.com", "www.chess.com"].includes(parsedUrl.hostname.toLowerCase())
  ) {
    return null;
  }

  const timeControl = typeof game.time_control === "string" ? game.time_control : "";
  if (game.rules !== "chess" || !isLeagueTimeControl(timeControl)) return null;
  if (typeof game.end_time !== "number" || !Number.isSafeInteger(game.end_time)) return null;
  if (game.end_time < cutoffEpochSeconds) return null;

  const whiteSourceResult = typeof white.result === "string" ? white.result : "";
  const blackSourceResult = typeof black.result === "string" ? black.result : "";
  if (isAbortedChessComResult(whiteSourceResult, blackSourceResult)) return null;
  const result = parseChessComResult(whiteSourceResult, blackSourceResult);

  return {
    // Preserve the exact stable identity provided by Chess.com.
    source_game_url: sourceGameUrl,
    white_player_id: whitePlayerId,
    black_player_id: blackPlayerId,
    result,
    white_source_result: whiteSourceResult,
    black_source_result: blackSourceResult,
    played_at: new Date(game.end_time * 1000).toISOString(),
    time_control: timeControl,
    rules: "chess",
    review_status:
      result !== null && !needsChessComHumanReview(whiteSourceResult, blackSourceResult)
        ? "approved"
        : "pending",
  };
}
