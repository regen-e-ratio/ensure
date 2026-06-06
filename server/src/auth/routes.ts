import { Router } from "express";
import type { Db } from "../db/index";
import type { AuthConfig } from "../config/env";
import { getUser, upsertUser } from "../db/user-repo";
import { createSession, deleteById, findByTokenHash, isExpired, rotate } from "../db/session-repo";
import { createRequireAuth } from "./require-auth";
import { createGoogleAuth } from "./google";
import {
  HANDSHAKE_COOKIE,
  REFRESH_COOKIE,
  clearAccessCookie,
  clearHandshakeCookie,
  clearRefreshCookie,
  setAccessCookie,
  setHandshakeCookie,
  setRefreshCookie,
} from "./cookies";
import {
  generateRefreshToken,
  hashToken,
  signAccessToken,
  signHandshake,
  verifyHandshake,
  type AuthUser,
} from "./tokens";

const UNAUTHORIZED = { error: "UNAUTHORIZED" } as const;

/** Only allow app-relative return paths (no protocol-relative // open redirects). */
function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function loginError(code: string): string {
  return `/login?error=${encodeURIComponent(code)}`;
}

/**
 * Issue a fresh session (access JWT cookie + opaque rotating refresh cookie) for
 * `user`. Shared by the Google callback and the test-login seam so both mint the
 * exact same cookie set.
 */
export async function establishSession(
  db: Db,
  res: import("express").Response,
  user: AuthUser,
  auth: AuthConfig,
  secure: boolean,
): Promise<void> {
  const refreshToken = generateRefreshToken();
  createSession(db, { userId: user.id, tokenHash: hashToken(refreshToken) });
  const accessToken = await signAccessToken(user, auth.jwtSecret);
  setAccessCookie(res, accessToken, secure);
  setRefreshCookie(res, refreshToken, secure);
}

/**
 * Router for /api/auth. Hosts the session-read endpoint, silent refresh, sign-out,
 * and (added with User Story 1) the Google sign-in start/callback.
 */
export function createAuthRouter(db: Db, auth: AuthConfig, secure: boolean): Router {
  const router = Router();
  const requireAuth = createRequireAuth(auth.jwtSecret);
  const google = createGoogleAuth(auth.google);

  // US1: begin Google sign-in — stash state+PKCE in a signed handshake cookie, redirect to Google.
  router.get("/google/start", async (req, res) => {
    const next = typeof req.query.next === "string" ? req.query.next : undefined;
    const { url, state, codeVerifier } = await google.createAuthRequest();
    const handshake = await signHandshake({ state, codeVerifier, next }, auth.jwtSecret);
    setHandshakeCookie(res, handshake, secure);
    res.redirect(302, url);
  });

  // US1: Google redirect target — validate state, exchange the code, provision the user, sign in.
  router.get("/google/callback", async (req, res) => {
    // User cancelled or Google denied (FR-013).
    if (typeof req.query.error === "string") {
      clearHandshakeCookie(res, secure);
      res.redirect(302, loginError(req.query.error));
      return;
    }

    const code = req.query.code;
    const state = req.query.state;
    const raw = req.cookies?.[HANDSHAKE_COOKIE] as string | undefined;
    const handshake = raw ? await verifyHandshake(raw, auth.jwtSecret) : null;
    clearHandshakeCookie(res, secure);

    if (
      typeof code !== "string" ||
      typeof state !== "string" ||
      !handshake ||
      handshake.state !== state
    ) {
      res.redirect(302, loginError("invalid_state"));
      return;
    }

    try {
      const profile = await google.exchangeCode(code, handshake.codeVerifier);
      const user = upsertUser(db, profile);
      await establishSession(db, res, user, auth, secure);
      res.redirect(302, safeNext(handshake.next));
    } catch {
      res.redirect(302, loginError("exchange_failed"));
    }
  });

  // Current authenticated user, or 401.
  router.get("/me", requireAuth, (req, res) => {
    res.status(200).json({ user: req.user });
  });

  // Silent refresh: rotate the session, slide its 24h expiry, re-issue the access cookie.
  router.post("/refresh", async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const session = raw ? findByTokenHash(db, hashToken(raw)) : null;
    if (!session || isExpired(session)) {
      res.status(401).json({ ...UNAUTHORIZED, message: "Session expired. Please sign in again." });
      return;
    }
    const user = getUser(db, session.userId);
    if (!user) {
      res.status(401).json({ ...UNAUTHORIZED, message: "Session expired. Please sign in again." });
      return;
    }
    const newRefresh = generateRefreshToken();
    rotate(db, session.id, hashToken(newRefresh));
    const accessToken = await signAccessToken(user, auth.jwtSecret);
    setAccessCookie(res, accessToken, secure);
    setRefreshCookie(res, newRefresh, secure);
    res.status(204).end();
  });

  // Sign out: delete the current session and clear both auth cookies (idempotent).
  router.post("/logout", (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (raw) {
      const session = findByTokenHash(db, hashToken(raw));
      if (session) deleteById(db, session.id);
    }
    clearAccessCookie(res, secure);
    clearRefreshCookie(res, secure);
    res.status(204).end();
  });

  return router;
}
