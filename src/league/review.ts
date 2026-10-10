import type { AdminDecision, LeagueGame } from "./model";

export interface ReviewUpdate {
  games: LeagueGame[];
  decisions: AdminDecision[];
  applied: boolean;
}

function sameDecision(left: AdminDecision, right: AdminDecision): boolean {
  return (
    left.id === right.id &&
    left.gameId === right.gameId &&
    left.adminUserId === right.adminUserId &&
    left.action === right.action &&
    left.decidedAt === right.decidedAt &&
    left.reason === right.reason &&
    left.correctedResult === right.correctedResult
  );
}

/**
 * Apply one admin decision to local records. Reusing the same decision ID and
 * payload is a no-op, so a retried request cannot change ratings twice.
 */
export function applyAdminDecision(
  games: readonly LeagueGame[],
  decisions: readonly AdminDecision[],
  decision: AdminDecision,
): ReviewUpdate {
  const priorDecision = decisions.find((item) => item.id === decision.id);
  if (priorDecision) {
    if (!sameDecision(priorDecision, decision)) {
      throw new Error("An admin decision ID cannot be reused with different data.");
    }
    return { games: [...games], decisions: [...decisions], applied: false };
  }

  if (!decision.adminUserId.trim() || !Number.isFinite(Date.parse(decision.decidedAt))) {
    throw new Error("A decision must include an admin ID and valid timestamp.");
  }

  const gameIndex = games.findIndex((game) => game.id === decision.gameId);
  if (gameIndex < 0) throw new Error("The game for this decision does not exist.");

  const currentGame = games[gameIndex];
  let nextGame: LeagueGame;
  switch (decision.action) {
    case "approved":
      if (currentGame.result === null) {
        throw new Error("A game with an unknown result cannot be approved without correction.");
      }
      nextGame = { ...currentGame, reviewStatus: "approved" };
      break;
    case "rejected":
      nextGame = { ...currentGame, reviewStatus: "rejected" };
      break;
    case "corrected_result":
      if (!decision.correctedResult) {
        throw new Error("A corrected-result decision must include the corrected result.");
      }
      nextGame = {
        ...currentGame,
        result: decision.correctedResult,
        reviewStatus: "approved",
      };
      break;
    default:
      throw new Error("The admin decision action is not supported.");
  }

  const nextGames = [...games];
  nextGames[gameIndex] = nextGame;
  return {
    games: nextGames,
    decisions: [...decisions, { ...decision }],
    applied: true,
  };
}
