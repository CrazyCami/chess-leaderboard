import type { GameResult } from "./elo";

export type GameSource = "chess_com" | "manual";
export type ReviewStatus = "pending" | "approved" | "rejected";

/** A league identity. External accounts are optional and are not ratings. */
export interface Player {
  id: string;
  displayName: string;
  chessComUsername?: string;
}

/** A normalized game record, independent of the source site's rating system. */
export interface LeagueGame {
  id: string;
  source: GameSource;
  /** Stable Chess.com game URL for imports; unique per source game. */
  sourceGameUrl?: string;
  whitePlayerId: string;
  blackPlayerId: string;
  /** Null means the source result was unclear and needs an admin decision. */
  result: GameResult | null;
  playedAt: string;
  /** PGN time-control notation, for example "600" or "600+0". */
  timeControl: string;
  /** Chess.com rules code; this league currently accepts standard chess only. */
  rules: string;
  reviewStatus: ReviewStatus;
}

export type AdminDecisionAction = "approved" | "rejected" | "corrected_result";

/** Append-only record of an admin decision. */
export interface AdminDecision {
  id: string;
  gameId: string;
  adminUserId: string;
  action: AdminDecisionAction;
  decidedAt: string;
  reason?: string;
  correctedResult?: GameResult;
}

export interface LeagueSettings {
  initialRating: number;
  kFactor: number;
}
