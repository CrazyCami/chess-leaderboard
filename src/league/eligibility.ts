import type { LeagueGame, Player } from "./model";

export type EligibilityReason =
  | "pending_review"
  | "rejected"
  | "unregistered_player"
  | "same_player"
  | "unsupported_variant"
  | "not_10_minute_zero_increment"
  | "unknown_result"
  | "invalid_date"
  | "pair_game_limit";

export type GameEligibility = { eligible: true } | { eligible: false; reason: EligibilityReason };

/**
 * Accept only the default 10+0 standard-chess control. Chess.com archives
 * express PGN controls in seconds: "600" means 600 seconds with no increment.
 */
export function isLeagueTimeControl(timeControl: string): boolean {
  const match = /^\s*(\d+)(?:\+(\d+))?\s*$/.exec(timeControl);
  if (!match) return false;

  const baseSeconds = Number(match[1]);
  const incrementSeconds = match[2] === undefined ? 0 : Number(match[2]);
  return baseSeconds === 600 && incrementSeconds === 0;
}

export function assessGameEligibility(game: LeagueGame, players: readonly Player[]): GameEligibility {
  if (game.reviewStatus === "pending") return { eligible: false, reason: "pending_review" };
  if (game.reviewStatus === "rejected") return { eligible: false, reason: "rejected" };

  const playerIds = new Set(players.map((player) => player.id));
  if (!playerIds.has(game.whitePlayerId) || !playerIds.has(game.blackPlayerId)) {
    return { eligible: false, reason: "unregistered_player" };
  }
  if (game.whitePlayerId === game.blackPlayerId) return { eligible: false, reason: "same_player" };
  if (game.rules !== "chess") return { eligible: false, reason: "unsupported_variant" };
  if (!isLeagueTimeControl(game.timeControl)) {
    return { eligible: false, reason: "not_10_minute_zero_increment" };
  }
  if (game.result === null) return { eligible: false, reason: "unknown_result" };
  if (!Number.isFinite(Date.parse(game.playedAt))) return { eligible: false, reason: "invalid_date" };

  return { eligible: true };
}
