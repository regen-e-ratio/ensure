import { defineConfig } from "@playwright/test";

const E2E_DB = "./data/e2e.db";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5173",
    // Set PW_CHANNEL=chrome to drive system Chrome where Playwright's bundled
    // chromium is unavailable; leave unset in CI to use the installed chromium.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    launchOptions: {
      args: ["--no-sandbox"],
    },
  },
  webServer: [
    {
      command: "npm run start --workspace server",
      port: 3000,
      reuseExistingServer: false,
      env: { NOTE_DB_PATH: E2E_DB, PORT: "3000", NOTE_ALLOW_TEST_RESET: "1" },
    },
    {
      command: "npm run dev --workspace client",
      port: 5173,
      reuseExistingServer: false,
    },
  ],
});
