const london = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});
const londonParts = Object.fromEntries(
  london.formatToParts(new Date()).map(({ type, value }) => [type, value]),
);
const londonDate = `${londonParts.year}-${londonParts.month}-${londonParts.day}`;
const londonHour = Number(londonParts.hour);

// GitHub Actions schedules use UTC: 15:00 UTC is 16:00 in BST and
// 16:00 UTC is 16:00 in GMT. Hour 17 is a one-hour delay recovery window.
if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" && londonHour !== 16 && londonHour !== 17) {
  console.log(`Outside the London sync window (${londonDate} ${londonHour}:00); skipping.`);
  process.exit(0);
}

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!supabaseUrl || !secretKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured as Actions secrets.");
}

const API_ROOT = "https://api.chess.com/pub";
const CUTOFF = Date.parse("2026-10-09T23:00:00.000Z") / 1000;
const headers = {
  "User-Agent": "SchoolChessLeague/1.0 (daily sync; contact league administrator)",
};

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
    throw new Error(`Chess.com returned HTTP ${response.status} for ${url}`);
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
const losingCodes = new Set(["checkmated", "resigned", "timeout", "lose"]);
const manualReviewCodes = new Set([
  ...drawCodes, "resigned", "timeout", "lose", "timevsinsufficient",
]);

function normalizeGame(game, userToPlayer) {
  if (!game || typeof game !== "object") return null;
  const whiteName = typeof game.white?.username === "string" ? game.white.username : "";
  const blackName = typeof game.black?.username === "string" ? game.black.username : "";
  const whiteId = userToPlayer.get(whiteName.toLocaleLowerCase("en-US"));
  const blackId = userToPlayer.get(blackName.toLocaleLowerCase("en-US"));
  if (!whiteId || !blackId || whiteId === blackId) return null;
  if (game.rules !== "chess" || typeof game.time_control !== "string" || !timeControlIsTenZero(game.time_control)) return null;
  if (!Number.isSafeInteger(game.end_time) || game.end_time < CUTOFF) return null;

  const url = typeof game.url === "string" ? game.url : "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["chess.com", "www.chess.com"].includes(parsed.hostname.toLowerCase())) return null;
  } catch {
    return null;
  }

  const whiteResult = typeof game.white?.result === "string" ? game.white.result.trim().toLowerCase() : "";
  const blackResult = typeof game.black?.result === "string" ? game.black.result.trim().toLowerCase() : "";
  if ([whiteResult, blackResult].some((result) => result === "abandoned" || result === "aborted")) return null;

  let result = null;
  if (whiteResult === "win" && losingCodes.has(blackResult)) result = "white_win";
  else if (blackResult === "win" && losingCodes.has(whiteResult)) result = "black_win";
  else if (drawCodes.has(whiteResult) && drawCodes.has(blackResult)) result = "draw";

  const needsReview = result === null || [whiteResult, blackResult].some((code) => manualReviewCodes.has(code));
  return {
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
  };
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
const userToPlayer = new Map(players.map((player) => [
  player.chesscom_username.toLocaleLowerCase("en-US"), player.id,
]));

const now = new Date();
const monthFloor = Date.UTC(2026, 9, 1);
const currentMonthFloor = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
const gamesByUrl = new Map();
let gamesSeen = 0;

// Fetch every monthly archive from the configured start month. The rolling
// backfill also catches Chess.com archive/cache updates that arrived late.
for (const player of players) {
  const archiveIndex = await getJson(`${API_ROOT}/player/${encodeURIComponent(player.chesscom_username)}/games/archives`);
  const archives = Array.isArray(archiveIndex.archives) ? archiveIndex.archives : [];
  for (const archiveUrl of archives) {
    const match = typeof archiveUrl === "string" && /\/(\d{4})\/(\d{2})$/.exec(archiveUrl);
    if (!match) continue;
    const archiveMonth = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
    if (archiveMonth < monthFloor || archiveMonth > currentMonthFloor) continue;
    const archive = await getJson(archiveUrl);
    for (const rawGame of Array.isArray(archive.games) ? archive.games : []) {
      const candidate = normalizeGame(rawGame, userToPlayer);
      if (!candidate) continue;
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
    p_players_checked: players.length,
    p_games_seen: gamesSeen,
    p_games: [...gamesByUrl.values()],
  }),
});
console.log(JSON.stringify({
  syncDate: londonDate,
  playersChecked: players.length,
  eligibleRecordsSeen: gamesSeen,
  uniqueGamesSubmitted: gamesByUrl.size,
  database: result,
}));
