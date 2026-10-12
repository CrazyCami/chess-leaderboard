import { normalizeGame } from "./chesscom-import-normalization.mjs";

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
const headers = {
  "User-Agent": "SchoolChessLeague/1.0 (scheduled sync; contact league administrator)",
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
let archivedGamesRead = 0;
const skippedGames = {};
const pendingReviewGames = {};

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
      archivedGamesRead += 1;
      const normalized = normalizeGame(rawGame, userToPlayer);
      if (!normalized.candidate) {
        skippedGames[normalized.skippedReason] = (skippedGames[normalized.skippedReason] ?? 0) + 1;
        continue;
      }
      const candidate = normalized.candidate;
      gamesSeen += 1;
      if (normalized.reviewReason) {
        pendingReviewGames[normalized.reviewReason] =
          (pendingReviewGames[normalized.reviewReason] ?? 0) + 1;
      }
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
  activeRosterPlayersWithoutChessComUsername: roster.length - players.length,
  archivedGamesRead,
  eligibleRecordsSeen: gamesSeen,
  uniqueGamesSubmitted: gamesByUrl.size,
  skippedGames,
  pendingReviewGames,
  database: result,
}));
