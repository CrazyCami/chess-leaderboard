import { expect, test } from "@playwright/test";

const supabase = "https://supabase.test";

test("leaderboard fits the phone and its table can scroll horizontally", async ({ page }) => {
  await page.route(`${supabase}/rest/v1/leaderboard**`, (route) => route.fulfill({
    json: [{
      player_id: "player-1",
      display_name: "Alex Example",
      chesscom_username: "alex-example",
      rating: 1200,
      wins: 4,
      draws: 1,
      losses: 2,
      games_played: 7,
    }],
  }));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Chess League" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Alex Example/ })).toBeVisible();

  const dimensions = await page.evaluate(() => {
    const scrollRegion = document.querySelector(".table-scroll");
    return {
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      region: scrollRegion.clientWidth,
      content: scrollRegion.scrollWidth,
    };
  });
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.content).toBeGreaterThan(dimensions.region);

  await page.locator(".table-scroll").evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect.poll(() => page.locator(".table-scroll").evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

test("admin can sign in and tap through the mobile review queue", async ({ page }) => {
  await page.route(/\/auth\/v1\/token\?grant_type=password$/, (route) => route.fulfill({
    json: {
      access_token: "mobile-test-token",
      refresh_token: "mobile-refresh-token",
      expires_in: 3600,
      user: { id: "mobile-admin-id" },
    },
  }));
  await page.route(`${supabase}/rest/v1/rpc/is_league_admin`, (route) => route.fulfill({ json: true }));
  await page.route(/\/rest\/v1\/players\?select=id,display_name$/, (route) => route.fulfill({
    json: [{ id: "white-player", display_name: "Alex Example" }, { id: "black-player", display_name: "Jamie Example" }],
  }));
  await page.route(`${supabase}/rest/v1/games?**`, (route) => route.fulfill({
    json: [{
      id: "mobile-game",
      source: "chess_com",
      source_game_url: "https://www.chess.com/game/live/mobile-test",
      white_player_id: "white-player",
      black_player_id: "black-player",
      result: "white_win",
      white_source_result: "win",
      black_source_result: "resigned",
      played_at: "2026-10-10T12:00:00.000Z",
      time_control: "600",
      rules: "chess",
    }],
  }));
  await page.route(`${supabase}/rest/v1/rpc/review_league_game`, (route) => route.fulfill({
    json: [{ decision_id: "decision-id", replay_id: "replay-id", was_retry: false }],
  }));

  await page.goto("/review");
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);

  await page.getByLabel("Email").tap();
  await page.getByLabel("Email").fill("admin@school.example");
  await page.getByLabel("Password").tap();
  await page.getByLabel("Password").fill("test-password");
  await page.getByRole("button", { name: "Sign in" }).tap();
  await expect(page.getByRole("heading", { name: "Pending games" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alex Example vs. Jamie Example" })).toBeVisible();

  await page.getByLabel("Decision reason (required)").tap();
  await page.getByLabel("Decision reason (required)").fill("Verified during mobile review.");
  await page.getByRole("button", { name: "Approve white win" }).tap();
  await expect(page.getByRole("status")).toContainText("Decision recorded");
});
