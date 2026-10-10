import type { GameResult } from "./elo";

const drawResults = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

const losingResults = new Set(["checkmated", "resigned", "timeout", "lose"]);

/** Result codes needing a human decision even when the winner can be inferred. */
const humanReviewResults = new Set([
  ...drawResults,
  "resigned",
  "timeout",
  "lose",
  "timevsinsufficient",
]);

/** Chess.com uses these when a game was abandoned before a result; ignore it. */
export function isAbortedChessComResult(...results: string[]): boolean {
  return results.some((result) => ["abandoned", "aborted"].includes(result.trim().toLowerCase()));
}

/** Only a recognized, unambiguous checkmate-style decisive result is auto-approved. */
export function needsChessComHumanReview(...results: string[]): boolean {
  return results.some((result) => humanReviewResults.has(result.trim().toLowerCase()));
}

/**
 * Convert the two player-side result codes into a league result.
 * Unknown, conflicting, or ambiguous source codes return null for admin review.
 */
export function parseChessComResult(whiteResult: string, blackResult: string): GameResult | null {
  const white = whiteResult.trim().toLowerCase();
  const black = blackResult.trim().toLowerCase();

  if (white === "win" && losingResults.has(black)) return "white_win";
  if (black === "win" && losingResults.has(white)) return "black_win";
  if (drawResults.has(white) && drawResults.has(black)) return "draw";

  return null;
}
