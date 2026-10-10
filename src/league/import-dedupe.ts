import type { LeagueGame } from "./model";

export interface ImportMergeResult {
  games: LeagueGame[];
  insertedIds: string[];
  duplicateIds: string[];
  conflictIds: string[];
}

function sameImportedFacts(left: LeagueGame, right: LeagueGame): boolean {
  return (
    left.source === right.source &&
    left.sourceGameUrl === right.sourceGameUrl &&
    left.whitePlayerId === right.whitePlayerId &&
    left.blackPlayerId === right.blackPlayerId &&
    left.result === right.result &&
    left.playedAt === right.playedAt &&
    left.timeControl === right.timeControl &&
    left.rules === right.rules
  );
}

/**
 * Merge one import batch by stable source identity. Identical retries are no-ops.
 * A changed source record is reported for review and never silently replaces
 * a previously stored or approved result.
 */
export function mergeImportedGames(
  existing: readonly LeagueGame[],
  incoming: readonly LeagueGame[],
): ImportMergeResult {
  const merged = [...existing];
  const bySourceUrl = new Map<string, LeagueGame>();
  for (const game of existing) {
    if (game.source === "chess_com" && game.sourceGameUrl) {
      bySourceUrl.set(game.sourceGameUrl, game);
    }
  }

  const insertedIds: string[] = [];
  const duplicateIds: string[] = [];
  const conflictIds: string[] = [];

  for (const candidate of incoming) {
    if (candidate.source !== "chess_com" || !candidate.sourceGameUrl) {
      throw new Error("Imported Chess.com games must have a stable source URL.");
    }

    const previous = bySourceUrl.get(candidate.sourceGameUrl);
    if (!previous) {
      const pendingGame: LeagueGame = { ...candidate, reviewStatus: "pending" };
      merged.push(pendingGame);
      bySourceUrl.set(candidate.sourceGameUrl, pendingGame);
      insertedIds.push(pendingGame.id);
      continue;
    }

    if (sameImportedFacts(previous, candidate)) duplicateIds.push(previous.id);
    else conflictIds.push(previous.id);
  }

  return { games: merged, insertedIds, duplicateIds, conflictIds };
}
