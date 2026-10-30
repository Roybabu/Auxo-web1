import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    environment: "jsdom",
    // e2e/ holds Playwright Test specs, run via `playwright test`, not Vitest.
    exclude: ["**/node_modules/**", "e2e/**"],
  },
});
