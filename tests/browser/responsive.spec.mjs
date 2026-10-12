import { expect, test } from "@playwright/test";

for (const viewport of [
  { name: "small phone", width: 320, height: 740 },
  { name: "large phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
]) {
  test(`leaderboard renders without page overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Chess League" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      shellWidth: document.querySelector(".page-shell").getBoundingClientRect().width,
    }));

    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.shellWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  });
}
