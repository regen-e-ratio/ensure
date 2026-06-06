import request from "supertest";
import type { Express } from "express";
import { createApp, type AppOptions } from "../../src/app";
import type { AuthConfig } from "../../src/config/env";
import { openDb, type Db } from "../../src/db/index";

/** Deterministic auth config for tests. `testMode` mounts the test-login seam. */
export const TEST_AUTH_CONFIG: AuthConfig = {
  jwtSecret: "test-jwt-secret-please-only-for-tests-0123456789",
  google: {
    clientId: "test-client-id.apps.googleusercontent.com",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/api/auth/google/callback",
  },
  testMode: true,
};

/** Build an in-memory app wired with the test auth config (+ test seams enabled). */
export function makeTestApp(overrides: Partial<AppOptions> = {}): { app: Express; db: Db } {
  const db = openDb(":memory:");
  const app = createApp(db, {
    auth: TEST_AUTH_CONFIG,
    enableTestReset: true,
    ...overrides,
  });
  return { app, db };
}

/**
 * Sign a fake user in via the test-login seam and return the resulting Set-Cookie
 * array, ready to attach to subsequent authenticated requests:
 *   await request(app).get("/api/note").set("Cookie", cookies)
 */
export async function loginTestUser(
  app: Express,
  body?: { sub?: string; email?: string; name?: string | null },
): Promise<string[]> {
  const res = await request(app)
    .post("/api/test/login")
    .send(body ?? {});
  const setCookie = res.headers["set-cookie"];
  return Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
}
