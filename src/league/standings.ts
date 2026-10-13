import {
  calculateEloChange,
  DEFAULT_K_FACTOR,
  ELO_FORMULA_VERSION,
  INITIAL_RATING,
} from "./elo";
import { assessGameEligibility, type EligibilityReason } from "./eligibility";
import type { LeagueGame, LeagueSettings, Player } from "./model";

export interface PlayerStanding {
  playerId: string;
  displayName: string;
  rating: number;
  wins: number;
  draws: number;
  losses: number;
  gamesPlayed: number;
}

export interface RatingEvent {
  formulaVersion: string;
  kFactor: number;
  gameId: string;
  playedAt: string;
  playerId: string;
  opponentId: string;
  result: "win" | "draw" | "loss";
  ratingBefore: number;
  change: number;
  ratingAfter: number;
}

export interface ExcludedGame {
  gameId: string;
  reason: EligibilityReason;
}

export interface RatingReplay {
  standings: PlayerStanding[];
  history: RatingEvent[];
  excludedGames: ExcludedGame[];
}

const DEFAULT_SETTINGS: LeagueSettings = {
  initialRating: INITIAL_RATING,
  kFactor: DEFAULT_K_FACTOR,
};

/**
 * Rebuild all current ratings from approved, eligible games in a stable order.
 * Replaying from the beginning makes late-arriving games deterministic and
 * avoids applying an Elo change twice on an import retry.
 */
export function replayRatings(
  players: readonly Player[],
  games: readonly LeagueGame[],
  settings: LeagueSettings = DEFAULT_SETTINGS,
): RatingReplay {
  if (!Number.isFinite(settings.initialRating)) {
    throw new RangeError("The initial rating must be a finite number.");
  }
  if (!Number.isFinite(settings.kFactor) || settings.kFactor <= 0) {
    throw new RangeError("The K-factor must be a positive finite number.");
  }

  if (new Set(players.map((player) => player.id)).size !== players.length) {
    throw new Error("Player IDs must be unique.");
  }
  if (new Set(games.map((game) => game.id)).size !== games.length) {
    throw new Error("Game IDs must be unique; replaying one game twice would double-count it.");
  }

  const standingsById = new Map<string, PlayerStanding>();
  for (const player of players) {
    standingsById.set(player.id, {
      playerId: player.id,
      displayName: player.displayName,
      rating: settings.initialRating,
      wins: 0,
      draws: 0,
      losses: 0,
      gamesPlayed: 0,
    });
  }

  const eligibleGames: LeagueGame[] = [];
  const excludedGames: ExcludedGame[] = [];
  for (const game of games) {
    const eligibility = assessGameEligibility(game, players);
    if (eligibility.eligible) eligibleGames.push(game);
    else excludedGames.push({ gameId: game.id, reason: eligibility.reason });
  }

  eligibleGames.sort((left, right) => {
    const dateDifference = Date.parse(left.playedAt) - Date.parse(right.playedAt);
    if (dateDifference !== 0) return dateDifference;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const history: RatingEvent[] = [];
  for (const game of eligibleGames) {
    const white = standingsById.get(game.whitePlayerId)!;
    const black = standingsById.get(game.blackPlayerId)!;
    const result = game.result!;
    const change = calculateEloChange(white.rating, black.rating, result, {
      kFactor: settings.kFactor,
    });

    const whiteResult = result === "white_win" ? "win" : result === "draw" ? "draw" : "loss";
    const blackResult = result === "black_win" ? "win" : result === "draw" ? "draw" : "loss";

    history.push({
      formulaVersion: ELO_FORMULA_VERSION,
      kFactor: settings.kFactor,
      gameId: game.id,
      playedAt: game.playedAt,
      playerId: white.playerId,
      opponentId: black.playerId,
      result: whiteResult,
      ratingBefore: white.rating,
      change: change.whiteChange,
      ratingAfter: change.whiteRatingAfter,
    });
    history.push({
      formulaVersion: ELO_FORMULA_VERSION,
      kFactor: settings.kFactor,
      gameId: game.id,
      playedAt: game.playedAt,
      playerId: black.playerId,
      opponentId: white.playerId,
      result: blackResult,
      ratingBefore: black.rating,
      change: change.blackChange,
      ratingAfter: change.blackRatingAfter,
    });

    white.rating = change.whiteRatingAfter;
    black.rating = change.blackRatingAfter;
    white.gamesPlayed += 1;
    black.gamesPlayed += 1;
    if (whiteResult === "win") white.wins += 1;
    else if (whiteResult === "draw") white.draws += 1;
    else white.losses += 1;
    if (blackResult === "win") black.wins += 1;
    else if (blackResult === "draw") black.draws += 1;
    else black.losses += 1;
  }

  const standings = [...standingsById.values()].sort(
    (left, right) => right.rating - left.rating || left.displayName.localeCompare(right.displayName),
  );

  return { standings, history, excludedGames };
}
