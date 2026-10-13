const londonDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !secretKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured as Actions secrets.");
}

const API_ROOT = "https://api.chess.com/pub";
const CUTOFF = Date.parse("2026-10-09T23:00:00.000Z") / 1000;
const fullBackfill = process.env.FULL_BACKFILL === "true";
const headers = {
  "User-Agent": "SchoolChessLeague/1.0 (scheduled sync; contact league administrator)",
};

class ChessComHttpError extends Error {
  constructor(status, url) {
    super(`Chess.com returned HTTP ${status} for ${url}`);
    this.name = "ChessComHttpError";
    this.status = status;
  }
}

async function getJson(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return response.json();
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60_000)
        : Math.min(2 ** attempt * 2000, 30_000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    throw new ChessComHttpError(response.status, url);
  }
  throw new Error(`Chess.com remained unavailable after retries: ${url}`);
}

function timeControlIsTenZero(value) {
  const match = /^\s*(\d+)(?:\+(\d+))?\s*$/.exec(value);
  return match !== null && Number(match[1]) === 600 && Number(match[2] ?? 0) === 0;
}

const drawCodes = new Set([
  "agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient",
]);
const losingCodes = new Set(["checkmated", "resigned", "timeout", "lose", "abandoned"]);
const manualReviewCodes = new Set([
  ...drawCodes, "timeout", "lose", "timevsinsufficient",
]);

function normalizeGame(game, userToPlayer) {
  if (!game || typeof game !== "object") return { game: null, reason: "invalid_payload" };
  const whiteName = typeof game.white?.username === "string" ? game.white.username : "";
  const blackName = typeof game.black?.username === "string" ? game.black.username : "";
  const whiteId = userToPlayer.get(whiteName.toLocaleLowerCase("en-US"));
  const blackId = userToPlayer.get(blackName.toLocaleLowerCase("en-US"));
  if (!whiteId || !blackId || whiteId === blackId) {
    return { game: null, reason: "not_two_distinct_registered_players" };
  }
  if (game.rules !== "chess") return { game: null, reason: "unsupported_variant" };
  if (typeof game.time_control !== "string" || !timeControlIsTenZero(game.time_control)) {
    return { game: null, reason: "not_10_plus_0" };
  }
  if (!Number.isSafeInteger(game.end_time)) return { game: null, reason: "invalid_end_time" };
  if (game.end_time < CUTOFF) return { game: null, reason: "before_league_cutoff" };

  const url = typeof game.url === "string" ? game.url : "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["chess.com", "www.chess.com"].includes(parsed.hostname.toLowerCase())) {
      return { game: null, reason: "invalid_chesscom_url" };
    }
  } catch {
    return { game: null, reason: "invalid_chesscom_url" };
  }

  const whiteResult = typeof game.white?.result === "string" ? game.white.result.trim().toLowerCase() : "";
  const blackResult = typeof game.black?.result === "string" ? game.black.result.trim().toLowerCase() : "";
  // "aborted" games never started; "abandoned" means a player walked away and forfeited.
  if ([whiteResult, blackResult].some((result) => result === "aborted")) {
    return { game: null, reason: "aborted" };
  }

  let result = null;
  if (whiteResult === "win" && losingCodes.has(blackResult)) result = "white_win";
  else if (blackResult === "win" && losingCodes.has(whiteResult)) result = "black_win";
  else if (drawCodes.has(whiteResult) && drawCodes.has(blackResult)) result = "draw";

  const needsReview = result === null || [whiteResult, blackResult].some((code) => manualReviewCodes.has(code));
  return { game: {
    source_game_url: url,
    white_player_id: whiteId,
    black_player_id: blackId,
    result,
    white_source_result: whiteResult,
    black_source_result: blackResult,
    played_at: new Date(game.end_time * 1000).toISOString(),
    time_control: game.time_control,
    rules: "chess",
    review_status: needsReview ? "pending" : "approved",
  }, reason: null };
}

async function supabase(path, options = {}) {
  const response = await fetch(new URL(`/rest/v1/${path}`, supabaseUrl), {
    ...options,
    headers: {
      // New Supabase secret keys are API keys, not JWTs: send only as apikey.
      apikey: secretKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Supabase returned HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

const roster = await supabase("players?select=id,chesscom_username&is_active=eq.true");
const players = roster.filter((player) => typeof player.chesscom_username === "string");
if (players.length === 0) {
  throw new Error("No active registered players with Chess.com usernames; refusing to complete an empty sync.");
}
const playersWithoutChessComUsername = roster.length - players.length;
const userToPlayer = new Map(players.map((player) => [
  player.chesscom_username.toLocaleLowerCase("en-US"), player.id,
]));

const now = new Date();
const monthFloor = Date.UTC(2026, 9, 1);
const currentMonthFloor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
const scanFromMonth = fullBackfill ? monthFloor : currentMonthFloor;
const gamesByUrl = new Map();
let gamesSeen = 0;
let archiveGamesSeen = 0;
const excludedGames = {};
let playersChecked = 0;
const playersWithUnavailableArchives = [];

// Frequent polls scan the current month. A daily full backfill catches late
// publications in older archives without repeatedly fetching all history.
for (const player of players) {
  let archiveIndex;
  try {
    archiveIndex = await getJson(`${API_ROOT}/player/${encodeURIComponent(player.chesscom_username)}/games/archives`);
    playersChecked += 1;
  } catch (error) {
    if (!(error instanceof ChessComHttpError) || error.status !== 404) throw error;
    playersWithUnavailableArchives.push(player.chesscom_username);
    console.warn(`Chess.com returned 404 for ${player.chesscom_username}'s archives; skipping this player's archive. Check the username and public archive availability.`);
    continue;
  }
  if (!archiveIndex || !Array.isArray(archiveIndex.archives)) {
    throw new Error(`Chess.com returned an invalid archive index for ${player.chesscom_username}.`);
  }
  const archives = archiveIndex.archives;
  for (const archiveUrl of archives) {
    const match = typeof archiveUrl === "string" && /\/(\d{4})\/(\d{2})$/.exec(archiveUrl);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) {
      throw new Error("Chess.com returned an invalid monthly archive URL; sync stopped rather than skipping it.");
    }
    const archiveMonth = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
    if (archiveMonth < scanFromMonth || archiveMonth > currentMonthFloor) continue;
    const archive = await getJson(archiveUrl);
    if (!archive || !Array.isArray(archive.games)) {
      throw new Error(`Chess.com returned an invalid monthly archive: ${archiveUrl}`);
    }
    for (const rawGame of archive.games) {
      archiveGamesSeen += 1;
      const { game: candidate, reason } = normalizeGame(rawGame, userToPlayer);
      if (!candidate) {
        excludedGames[reason] = (excludedGames[reason] ?? 0) + 1;
        continue;
      }
      gamesSeen += 1;
      const previous = gamesByUrl.get(candidate.source_game_url);
      if (previous && JSON.stringify(previous) !== JSON.stringify(candidate)) {
        throw new Error(`Chess.com returned conflicting facts for ${candidate.source_game_url}; import stopped for review.`);
      }
      gamesByUrl.set(candidate.source_game_url, candidate);
    }
  }
}

const result = await supabase("rpc/import_chesscom_games", {
  method: "POST",
  body: JSON.stringify({
    p_sync_date: londonDate,
    p_players_checked: playersChecked,
    p_games_seen: gamesSeen,
    p_games: [...gamesByUrl.values()],
  }),
});
console.log(JSON.stringify({
  syncDate: londonDate,
  syncType: fullBackfill ? "full_backfill" : "recent_month",
  playersChecked,
  playersWithoutChessComUsername,
  archiveGamesSeen,
  playersWithUnavailableArchives,
  eligibleRecordsSeen: gamesSeen,
  uniqueGamesSubmitted: gamesByUrl.size,
  excludedGames,
  database: result,
}));
