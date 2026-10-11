import assert from "node:assert/strict";
import test from "node:test";

import { calculateEloChange } from "../node_modules/.cache/league-test-build/elo.js";
import {
  isAbortedChessComResult,
  needsChessComHumanReview,
  parseChessComResult,
} from "../node_modules/.cache/league-test-build/chess-com-result.js";
import { normalizeChessComArchiveGame } from "../node_modules/.cache/league-test-build/chess-com-published-data.js";
import { assessGameEligibility } from "../node_modules/.cache/league-test-build/eligibility.js";
import { mergeImportedGames } from "../node_modules/.cache/league-test-build/import-dedupe.js";
import { applyAdminDecision } from "../node_modules/.cache/league-test-build/review.js";
import { replayRatings } from "../node_modules/.cache/league-test-build/standings.js";

const players = [
  { id: "alice", displayName: "Alice", chessComUsername: "alice" },
  { id: "bob", displayName: "Bob", chessComUsername: "bob" },
];

function game(overrides = {}) {
  return {
    id: "game-1",
    source: "manual",
    whitePlayerId: "alice",
    blackPlayerId: "bob",
    result: "white_win",
    playedAt: "2026-10-10T12:00:00.000Z",
    timeControl: "600",
    rules: "chess",
    reviewStatus: "approved",
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    id: "decision-1",
    gameId: "game-1",
    adminUserId: "admin-1",
    action: "approved",
    decidedAt: "2026-10-11T12:00:00.000Z",
    reason: "Verified against the game record.",
    ...overrides,
  };
}

test("equal-rated wins transfer 16 points and preserve total rating", () => {
  const result = calculateEloChange(1000, 1000, "white_win");
  assert.equal(result.whiteRatingAfter, 1016);
  assert.equal(result.blackRatingAfter, 984);
  assert.equal(result.whiteRatingAfter + result.blackRatingAfter, 2000);

  const blackWin = calculateEloChange(1000, 1000, "black_win");
  assert.equal(blackWin.whiteRatingAfter, 984);
  assert.equal(blackWin.blackRatingAfter, 1016);
});

test("an equal-rated draw leaves both ratings unchanged", () => {
  const result = calculateEloChange(1000, 1000, "draw");
  assert.equal(result.whiteRatingAfter, 1000);
  assert.equal(result.blackRatingAfter, 1000);
});

test("rating calculation rejects invalid ratings and K-factors", () => {
  assert.throws(() => calculateEloChange(Number.NaN, 1000, "draw"), RangeError);
  assert.throws(() => calculateEloChange(1000, 1000, "draw", { kFactor: 0 }), RangeError);
});

test("recognized decisive outcomes map to the correct league winner", () => {
  assert.equal(parseChessComResult("win", "checkmated"), "white_win");
  assert.equal(parseChessComResult("resigned", "win"), "black_win");
  assert.equal(parseChessComResult("win", "win"), null);
  assert.equal(parseChessComResult("unknown", "checkmated"), null);
});

test("draw codes are human-reviewed and abandoned games are ignored", () => {
  for (const result of ["agreed", "repetition", "stalemate", "insufficient", "50move"]) {
    assert.equal(parseChessComResult(result, result), "draw");
    assert.equal(needsChessComHumanReview(result), true);
  }
  assert.equal(parseChessComResult("timevsinsufficient", "timevsinsufficient"), "draw");
  assert.equal(needsChessComHumanReview("timevsinsufficient"), true);
  assert.equal(isAbortedChessComResult("abandoned"), true);
  assert.equal(isAbortedChessComResult("aborted"), true);
  assert.equal(isAbortedChessComResult("checkmated"), false);
});

test("archive imports auto-approve checkmate but hold uncertain results for review", () => {
  const base = {
    url: "https://www.chess.com/game/live/123",
    rules: "chess",
    time_control: "600",
    end_time: 1_792_000_000,
    white: { username: "Alice", result: "win" },
    black: { username: "Bob", result: "checkmated" },
  };
  const roster = [
    { id: "alice", chesscom_username: "alice" },
    { id: "bob", chesscom_username: "bob" },
  ];
  const cutoff = 1_700_000_000;

  const clearWin = normalizeChessComArchiveGame(base, roster, cutoff);
  assert.equal(clearWin.result, "white_win");
  assert.equal(clearWin.review_status, "approved");

  const agreedDraw = normalizeChessComArchiveGame({
    ...base,
    white: { username: "Alice", result: "agreed" },
    black: { username: "Bob", result: "agreed" },
  }, roster, cutoff);
  assert.equal(agreedDraw.result, "draw");
  assert.equal(agreedDraw.review_status, "pending");

  const resignation = normalizeChessComArchiveGame({
    ...base,
    black: { username: "Bob", result: "resigned" },
  }, roster, cutoff);
  assert.equal(resignation.result, "white_win");
  assert.equal(resignation.review_status, "pending");

  const timeout = normalizeChessComArchiveGame({
    ...base,
    black: { username: "Bob", result: "timeout" },
  }, roster, cutoff);
  assert.equal(timeout.result, "white_win");
  assert.equal(timeout.review_status, "pending");

  const unknown = normalizeChessComArchiveGame({
    ...base,
    black: { username: "Bob", result: "unrecognized-result" },
  }, roster, cutoff);
  assert.equal(unknown.result, null);
  assert.equal(unknown.review_status, "pending");

  assert.equal(normalizeChessComArchiveGame({
    ...base,
    black: { username: "Bob", result: "abandoned" },
  }, roster, cutoff), null);
  assert.equal(normalizeChessComArchiveGame({ ...base, time_control: "600+5" }, roster, cutoff), null);
  assert.equal(normalizeChessComArchiveGame({ ...base, rules: "chess960" }, roster, cutoff), null);
  assert.equal(normalizeChessComArchiveGame({ ...base, end_time: cutoff - 1 }, roster, cutoff), null);
});

test("an aborted game is excluded and changes neither player's Elo", () => {
  const aborted = normalizeChessComArchiveGame({
    url: "https://www.chess.com/game/live/aborted",
    rules: "chess",
    time_control: "600",
    end_time: 1_792_000_000,
    white: { username: "Alice", result: "aborted" },
    black: { username: "Bob", result: "win" },
  }, [
    { id: "alice", chesscom_username: "alice" },
    { id: "bob", chesscom_username: "bob" },
  ], 1_700_000_000);

  assert.equal(aborted, null);
  const replay = replayRatings(players, []);
  assert.equal(replay.history.length, 0);
  assert.deepEqual(
    replay.standings.map(({ playerId, rating }) => [playerId, rating]),
    [["alice", 1000], ["bob", 1000]],
  );
});

test("rating replay counts approved eligible wins, losses, and draws chronologically", () => {
  const games = [
    game({ id: "later", result: "draw", playedAt: "2026-10-10T13:00:00.000Z" }),
    game({ id: "earlier", result: "white_win", playedAt: "2026-10-10T12:00:00.000Z" }),
    game({ id: "pending", reviewStatus: "pending" }),
    game({ id: "increment", timeControl: "600+5" }),
  ];
  const replay = replayRatings(players, games);

  assert.deepEqual(replay.history.filter((event) => event.playerId === "alice").map((event) => event.gameId), [
    "earlier",
    "later",
  ]);
  const aliceStanding = replay.standings.find((standing) => standing.playerId === "alice");
  assert.equal(aliceStanding.playerId, "alice");
  assert.ok(Math.abs(aliceStanding.rating - 1014.5304984710245) < 1e-10);
  assert.equal(aliceStanding.wins, 1);
  assert.equal(aliceStanding.draws, 1);
  assert.equal(aliceStanding.losses, 0);
  assert.equal(aliceStanding.gamesPlayed, 2);
  assert.deepEqual(replay.excludedGames.map(({ gameId }) => gameId).sort(), ["increment", "pending"]);
});

test("eligibility excludes an unregistered opponent and malformed played time", () => {
  assert.deepEqual(assessGameEligibility(game({ blackPlayerId: "outsider" }), players), {
    eligible: false,
    reason: "unregistered_player",
  });
  assert.deepEqual(assessGameEligibility(game({ playedAt: "not-a-date" }), players), {
    eligible: false,
    reason: "invalid_date",
  });
});

test("admin decisions approve, reject, and correct results with retry safety", () => {
  const pending = game({ reviewStatus: "pending" });
  const approved = applyAdminDecision([pending], [], decision());
  assert.equal(approved.games[0].reviewStatus, "approved");
  assert.equal(approved.applied, true);

  const retried = applyAdminDecision(approved.games, approved.decisions, decision());
  assert.equal(retried.applied, false);
  assert.throws(() => applyAdminDecision(
    approved.games,
    approved.decisions,
    decision({ action: "rejected" }),
  ), /different data/);

  const rejected = applyAdminDecision([pending], [], decision({ action: "rejected" }));
  assert.equal(rejected.games[0].reviewStatus, "rejected");

  const corrected = applyAdminDecision([game({ result: null, reviewStatus: "pending" })], [], decision({
    action: "corrected_result",
    correctedResult: "draw",
  }));
  assert.equal(corrected.games[0].result, "draw");
  assert.equal(corrected.games[0].reviewStatus, "approved");

  assert.throws(() => applyAdminDecision(
    [game({ result: null, reviewStatus: "pending" })],
    [],
    decision(),
  ), /unknown result/);
});

test("reimporting the same source game is a no-op and changed facts conflict", () => {
  const imported = game({
    id: "imported",
    source: "chess_com",
    sourceGameUrl: "https://www.chess.com/game/live/123",
  });
  const first = mergeImportedGames([], [imported]);
  assert.deepEqual(first.insertedIds, ["imported"]);
  assert.equal(first.games[0].reviewStatus, "pending");

  const duplicate = mergeImportedGames(first.games, [imported]);
  assert.deepEqual(duplicate.duplicateIds, ["imported"]);
  assert.deepEqual(duplicate.insertedIds, []);

  const changed = mergeImportedGames(first.games, [{ ...imported, result: "black_win" }]);
  assert.deepEqual(changed.conflictIds, ["imported"]);
});
