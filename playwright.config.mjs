import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "desktop-chromium",
      testIgnore: "**/mobile.spec.mjs",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "iphone-safari",
      testMatch: "**/mobile.spec.mjs",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
    {
      name: "android-chrome",
      testMatch: "**/mobile.spec.mjs",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
