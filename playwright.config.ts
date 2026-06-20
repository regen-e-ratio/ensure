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
      env: {
        NOTE_DB_PATH: E2E_DB,
        PORT: "3000",
        NOTE_ALLOW_TEST_RESET: "1",
        // Auth is gated behind SSO; e2e never drives the real Google screen — it uses
        // the AUTH_TEST_MODE=1 test-login seam. Dummy Google/JWT values let the server boot.
        AUTH_TEST_MODE: "1",
        GOOGLE_CLIENT_ID: "e2e-client-id.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "e2e-client-secret",
        GOOGLE_REDIRECT_URI: "http://localhost:3000/api/auth/google/callback",
        AUTH_JWT_SECRET: "e2e-jwt-secret-please-only-for-e2e-0123456789",
        // Deterministic single-version encryption keyring for e2e (base64 of 32 bytes).
        NOTE_ENC_KEYS: "1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        NOTE_ENC_ACTIVE_VERSION: "1",
        // Dead-man switch (feature 008): keep the in-process timer off so e2e is deterministic
        // (it drives transitions via the fast-forward seam, which runs one tick itself), and
        // mount the fast-forward test seam.
        DEADMAN_TICK_DISABLED: "1",
        DEADMAN_TEST_MODE: "1",
      },
    },
    {
      command: "npm run dev --workspace client",
      port: 5173,
      reuseExistingServer: false,
    },
  ],
});
