import type { GameResult } from "./elo";

const drawResults = new Set([
  "agreed",
  "repetition",
  "stalemate",
  "insufficient",
  "50move",
  "timevsinsufficient",
]);

const losingResults = new Set(["checkmated", "resigned", "timeout", "lose", "abandoned"]);

/** Result codes needing a human decision even when the winner can be inferred. */
const humanReviewResults = new Set([
  ...drawResults,
  "timeout",
  "lose",
  "timevsinsufficient",
]);

/**
 * Chess.com uses "aborted" when a game ended before it really started, so it
 * has no result and is ignored. "abandoned" is different: the player walked
 * away from a live game and forfeited, so it counts as a loss like a resignation.
 */
export function isAbortedChessComResult(...results: string[]): boolean {
  return results.some((result) => result.trim().toLowerCase() === "aborted");
}

/** Results needing human review even when the winner can be inferred. */
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
