const CUTOFF = Date.parse("2026-10-09T23:00:00.000Z") / 1000;

const drawCodes = new Set([
  "agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient",
]);
const losingCodes = new Set(["checkmated", "resigned", "timeout", "lose"]);
const manualReviewCodes = new Set([
  ...drawCodes, "timeout", "lose", "timevsinsufficient",
]);

function timeControlIsTenZero(value) {
  const match = /^\s*(\d+)(?:\+(\d+))?\s*$/.exec(value);
  return match !== null && Number(match[1]) === 600 && Number(match[2] ?? 0) === 0;
}

function skipped(reason) {
  return { candidate: null, skippedReason: reason, reviewReason: null };
}

export function normalizeGame(game, userToPlayer) {
  if (!game || typeof game !== "object") return skipped("invalid_archive_record");
  const whiteName = typeof game.white?.username === "string" ? game.white.username : "";
  const blackName = typeof game.black?.username === "string" ? game.black.username : "";
  const whiteId = userToPlayer.get(whiteName.toLocaleLowerCase("en-US"));
  const blackId = userToPlayer.get(blackName.toLocaleLowerCase("en-US"));
  if (!whiteId || !blackId) return skipped("unregistered_player");
  if (whiteId === blackId) return skipped("same_player");
  if (game.rules !== "chess") return skipped("unsupported_variant");
  if (typeof game.time_control !== "string" || !timeControlIsTenZero(game.time_control)) {
    return skipped("unsupported_time_control");
  }
  if (!Number.isSafeInteger(game.end_time)) return skipped("invalid_end_time");
  if (game.end_time < CUTOFF) return skipped("before_cutoff");

  const url = typeof game.url === "string" ? game.url : "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["chess.com", "www.chess.com"].includes(parsed.hostname.toLowerCase())) {
      return skipped("invalid_game_url");
    }
  } catch {
    return skipped("invalid_game_url");
  }

  const whiteResult = typeof game.white?.result === "string" ? game.white.result.trim().toLowerCase() : "";
  const blackResult = typeof game.black?.result === "string" ? game.black.result.trim().toLowerCase() : "";
  if ([whiteResult, blackResult].some((result) => result === "abandoned" || result === "aborted")) {
    return skipped("abandoned_or_aborted");
  }

  let result = null;
  if (whiteResult === "win" && losingCodes.has(blackResult)) result = "white_win";
  else if (blackResult === "win" && losingCodes.has(whiteResult)) result = "black_win";
  else if (drawCodes.has(whiteResult) && drawCodes.has(blackResult)) result = "draw";

  const needsReview = result === null || [whiteResult, blackResult].some((code) => manualReviewCodes.has(code));
  let reviewReason = null;
  if (needsReview) {
    if (result === "draw") reviewReason = "draw_requires_review";
    else if ([whiteResult, blackResult].some((code) => code === "timeout" || code === "timevsinsufficient")) {
      reviewReason = "timeout_or_possible_timeout_requires_review";
    } else if ([whiteResult, blackResult].includes("lose")) {
      reviewReason = "generic_loss_requires_review";
    } else {
      reviewReason = "unclear_result_requires_review";
    }
  }

  return {
    candidate: {
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
    },
    skippedReason: null,
    reviewReason,
  };
}
