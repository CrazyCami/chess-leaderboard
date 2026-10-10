import type { LeagueGame, Player } from "./model";

/** Fictional development records only. Replace only after the team is ready. */
export const samplePlayers: Player[] = [
  { id: "player-ash", displayName: "Sample Player Ash" },
  { id: "player-birch", displayName: "Sample Player Birch" },
  { id: "player-cedar", displayName: "Sample Player Cedar" },
];

export const sampleGames: LeagueGame[] = [
  {
    id: "sample-game-001",
    source: "manual",
    whitePlayerId: "player-ash",
    blackPlayerId: "player-birch",
    result: "white_win",
    playedAt: "2026-09-15T15:00:00.000Z",
    timeControl: "600+0",
    rules: "chess",
    reviewStatus: "approved",
  },
  {
    id: "sample-game-002",
    source: "manual",
    whitePlayerId: "player-birch",
    blackPlayerId: "player-cedar",
    result: "draw",
    playedAt: "2026-09-16T15:00:00.000Z",
    timeControl: "600",
    rules: "chess",
    reviewStatus: "approved",
  },
  {
    id: "sample-game-003",
    source: "manual",
    whitePlayerId: "player-ash",
    blackPlayerId: "player-cedar",
    result: "black_win",
    playedAt: "2026-09-17T15:00:00.000Z",
    timeControl: "600+5",
    rules: "chess",
    reviewStatus: "approved",
  },
  {
    id: "sample-game-004",
    source: "manual",
    whitePlayerId: "player-cedar",
    blackPlayerId: "player-ash",
    result: "black_win",
    playedAt: "2026-09-18T15:00:00.000Z",
    timeControl: "600+0",
    rules: "chess",
    reviewStatus: "pending",
  },
];
