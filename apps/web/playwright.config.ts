import { defineConfig, devices } from "@playwright/test";

const PORT = 5183;
// vite.config.ts always serves from this base path (GitHub Pages project site), in dev too.
const BASE_PATH = "/Auxo-web1/";
const BASE_URL = `http://localhost:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  // The whole suite drives one shared page through a single sequential story (shop setup, sign
  // in, billing, backup/restore), so tests can't run in parallel or in another order.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec vite dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Unset in CI (standard `playwright install` applies); only for pointing at a
        // pre-installed browser in environments that can't download one.
        launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ["--no-sandbox"] }
          : {},
      },
    },
  ],
});
