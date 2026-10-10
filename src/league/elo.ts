/** The outcome of a game from White's point of view. */
export type GameResult = "white_win" | "draw" | "black_win";

export interface EloSettings {
  /** Rating points used to update each player's rating after a game. */
  kFactor: number;
}

export interface EloChange {
  whiteExpectedScore: number;
  blackExpectedScore: number;
  whiteScore: number;
  blackScore: number;
  whiteChange: number;
  blackChange: number;
  whiteRatingAfter: number;
  blackRatingAfter: number;
}

export const INITIAL_RATING = 1000;
export const DEFAULT_K_FACTOR = 32;
export const ELO_FORMULA_VERSION = "standard-elo-v1";

const DEFAULT_SETTINGS: EloSettings = {
  kFactor: DEFAULT_K_FACTOR,
};

/**
 * Return the score a player is expected to earn from their rating difference.
 * In Elo, a win is 1 point, a draw is 0.5, and a loss is 0.
 */
function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

/**
 * Calculate a two-player Elo update without saving it anywhere.
 *
 * The returned ratings are unrounded so the league can agree its display and
 * storage precision before results are persisted.
 */
export function calculateEloChange(
  whiteRating: number,
  blackRating: number,
  result: GameResult,
  settings: EloSettings = DEFAULT_SETTINGS,
): EloChange {
  if (!Number.isFinite(whiteRating) || !Number.isFinite(blackRating)) {
    throw new RangeError("Player ratings must be finite numbers.");
  }

  if (!Number.isFinite(settings.kFactor) || settings.kFactor <= 0) {
    throw new RangeError("The K-factor must be a positive finite number.");
  }

  let whiteScore: number;
  switch (result) {
    case "white_win":
      whiteScore = 1;
      break;
    case "draw":
      whiteScore = 0.5;
      break;
    case "black_win":
      whiteScore = 0;
      break;
    default:
      throw new RangeError("The game result is not supported.");
  }

  const blackScore = 1 - whiteScore;
  const whiteExpectedScore = expectedScore(whiteRating, blackRating);
  const blackExpectedScore = expectedScore(blackRating, whiteRating);
  const whiteChange = settings.kFactor * (whiteScore - whiteExpectedScore);
  const blackChange = settings.kFactor * (blackScore - blackExpectedScore);

  return {
    whiteExpectedScore,
    blackExpectedScore,
    whiteScore,
    blackScore,
    whiteChange,
    blackChange,
    whiteRatingAfter: whiteRating + whiteChange,
    blackRatingAfter: blackRating + blackChange,
  };
}
