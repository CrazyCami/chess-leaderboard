import { registeredPlayers } from "./roster";
import type { LeagueGame } from "./model";
import { replayRatings } from "./standings";

/** Empty game list keeps the public starter leaderboard at initial ratings. */
export const demoGames: LeagueGame[] = [];

export const demoRatingReplay = replayRatings(registeredPlayers, demoGames);
