import { expect, test } from "@playwright/test";

const supabase = "https://supabase.test";

test("leaderboard shows live-style standings and leaves inactive rank blank", async ({ page }) => {
  await page.route(`${supabase}/rest/v1/leaderboard**`, (route) => route.fulfill({
    json: [
      { player_id: "p1", display_name: "Ari Example", chesscom_username: "ari", rating: 1016.25, wins: 1, draws: 0, losses: 0, games_played: 1 },
      { player_id: "p2", display_name: "Bo Example", chesscom_username: null, rating: 1000, wins: 0, draws: 0, losses: 0, games_played: 0 },
    ],
  }));

  await page.goto("/");
  const rows = page.getByRole("table").getByRole("row");
  await expect(rows.nth(1)).toContainText("Ari Example");
  await expect(rows.nth(1)).toContainText("1016");
  await expect(rows.nth(1).getByRole("cell").first()).toHaveText("1");
  await expect(rows.nth(2)).toContainText("Bo Example");
  await expect(rows.nth(2).getByRole("cell").first()).toHaveText("—");
});

test("leaderboard reports database errors accessibly", async ({ page }) => {
  await page.route(`${supabase}/rest/v1/leaderboard**`, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ message: "Database temporarily unavailable" }),
  }));

  await page.goto("/");
  await expect(page.locator(".leaderboard [role='alert']")).toContainText("Supabase returned HTTP 503");
});

test("leaderboard reports an empty roster", async ({ page }) => {
  await page.route(`${supabase}/rest/v1/leaderboard**`, (route) => route.fulfill({ json: [] }));

  await page.goto("/");
  await expect(page.getByText("No active players found.")).toBeVisible();
});

test("leaderboard announces its loading state to assistive technology", async ({ page }) => {
  await page.route(`${supabase}/rest/v1/leaderboard**`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ json: [] });
  });

  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Loading leaderboard");
  await expect(page.getByText("No active players found.")).toBeVisible();
});

test("admin signs in, verifies role, records an approval, and refreshes the queue", async ({ page }) => {
  const decisions = [];
  const games = [
    {
      id: "game-uuid",
      source: "chess_com",
      source_game_url: "https://www.chess.com/game/live/123",
      white_player_id: "alice",
      black_player_id: "bob",
      result: "white_win",
      white_source_result: "win",
      black_source_result: "checkmated",
      played_at: "2026-10-10T12:00:00.000Z",
      time_control: "600",
      rules: "chess",
    },
    {
      id: "unclear-game-uuid",
      source: "chess_com",
      source_game_url: "https://www.chess.com/game/live/456",
      white_player_id: "alice",
      black_player_id: "bob",
      result: null,
      white_source_result: "win",
      black_source_result: "unknown",
      played_at: "2026-10-10T12:30:00.000Z",
      time_control: "600",
      rules: "chess",
    },
    {
      id: "reject-game-uuid",
      source: "manual",
      source_game_url: null,
      white_player_id: "alice",
      black_player_id: "bob",
      result: "black_win",
      white_source_result: null,
      black_source_result: null,
      played_at: "2026-10-10T13:00:00.000Z",
      time_control: "600",
      rules: "chess",
    },
  ];
  const resolvedIds = new Set();
  await page.route(/\/auth\/v1\/token\?grant_type=password$/, async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      email: "admin@school.example",
      password: "school-password",
    });
    await route.fulfill({
      json: {
        access_token: "test-access-token",
        refresh_token: "test-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "admin-user-id" },
      },
    });
  });
  await page.route(`${supabase}/rest/v1/rpc/is_league_admin`, (route) => route.fulfill({ json: true }));
  await page.route(/\/rest\/v1\/players\?select=id,display_name$/, (route) => route.fulfill({
    json: [{ id: "alice", display_name: "Ari Example" }, { id: "bob", display_name: "Bo Example" }],
  }));
  await page.route(`${supabase}/rest/v1/games?**`, (route) => {
    return route.fulfill({
      json: games.filter((game) => !resolvedIds.has(game.id)),
    });
  });
  await page.route(`${supabase}/rest/v1/rpc/review_league_game`, async (route) => {
    const decision = route.request().postDataJSON();
    decisions.push(decision);
    resolvedIds.add(decision.p_game_id);
    await route.fulfill({ json: [{ decision_id: "decision-uuid", replay_id: "replay-uuid", was_retry: false }] });
  });

  await page.goto("/review");
  await page.getByLabel("Email").focus();
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  await page.getByLabel("Email").fill("admin@school.example");
  await page.getByLabel("Password").fill("school-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Pending games" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ari Example vs. Bo Example" })).toHaveCount(3);
  await page.getByRole("button", { name: "Approve white win" }).click();
  await expect(page.locator(".admin-panel [role='alert']")).toContainText("Enter a decision reason");
  await page.getByLabel("Decision reason (required)").first().fill("Verified against the game record.");
  await page.getByRole("button", { name: "Approve white win" }).click();
  await expect(page.getByText("Correct it to the verified outcome or reject the game.")).toBeVisible();
  await page.locator("#reason-unclear-game-uuid").fill("Checked the source record with both players.");
  await page.locator("#correction-unclear-game-uuid").selectOption("draw");
  await page.locator(".review-card").filter({ has: page.locator("#correction-unclear-game-uuid") }).getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("heading", { name: "Ari Example vs. Bo Example" })).toHaveCount(2);
  await page.locator("#reason-reject-game-uuid").fill("Organizer confirmed this report was not reliable.");
  await page.locator(".review-card").filter({ has: page.locator("#reason-reject-game-uuid") }).getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("No games are waiting for review.")).toBeVisible();

  expect(decisions[0]).toMatchObject({
    p_game_id: "game-uuid",
    p_action: "approved",
    p_reason: "Verified against the game record.",
    p_corrected_result: null,
  });
  expect(decisions[0].p_request_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(decisions[1]).toMatchObject({
    p_game_id: "unclear-game-uuid",
    p_action: "corrected_result",
    p_reason: "Checked the source record with both players.",
    p_corrected_result: "draw",
  });
  expect(decisions[2]).toMatchObject({
    p_game_id: "reject-game-uuid",
    p_action: "rejected",
    p_reason: "Organizer confirmed this report was not reliable.",
    p_corrected_result: null,
  });
});

test("admin rejects signed-in users not provisioned as league admins", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("school-chess-league-admin-session", JSON.stringify({
      access_token: "test-access-token",
      refresh_token: "test-refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "not-an-admin" },
    }));
  });
  await page.route(`${supabase}/rest/v1/rpc/is_league_admin`, (route) => route.fulfill({ json: false }));

  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("school-chess-league-admin-session"))).toBeNull();
});

test("legacy admin URL redirects to the game review page", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "Game review" })).toBeVisible();
});
