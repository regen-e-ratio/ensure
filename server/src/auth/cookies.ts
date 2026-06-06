import type { Response } from "express";
import { ACCESS_TOKEN_TTL_SECONDS, HANDSHAKE_TTL_SECONDS } from "./tokens";
import { SESSION_TTL_MS } from "../db/session-repo";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
export const HANDSHAKE_COOKIE = "oauth_handshake";

/** Path scope for the refresh cookie — sent to /api/auth/* (refresh + logout) only. */
const REFRESH_PATH = "/api/auth";

/**
 * Shared cookie attributes. `secure` is toggled off in test mode so Supertest and
 * the Playwright dev server (plain HTTP) still receive the cookies, while production
 * sets Secure. All auth cookies are httpOnly and SameSite=Lax (D2/D3).
 */
function base(secure: boolean) {
  return { httpOnly: true, secure, sameSite: "lax" } as const;
}

/** Set the ~1h access-token cookie (sent with every same-origin request). */
export function setAccessCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(ACCESS_COOKIE, token, {
    ...base(secure),
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
}

/** Set the opaque refresh-token cookie, path-scoped to /api/auth. */
export function setRefreshCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...base(secure),
    path: REFRESH_PATH,
    maxAge: SESSION_TTL_MS,
  });
}

/** Set the short-lived OAuth handshake cookie (scoped to the callback route). */
export function setHandshakeCookie(res: Response, token: string, secure: boolean): void {
  res.cookie(HANDSHAKE_COOKIE, token, {
    ...base(secure),
    path: "/api/auth/google",
    maxAge: HANDSHAKE_TTL_SECONDS * 1000,
  });
}

export function clearAccessCookie(res: Response, secure: boolean): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(secure), path: "/" });
}

export function clearRefreshCookie(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, { ...base(secure), path: REFRESH_PATH });
}

export function clearHandshakeCookie(res: Response, secure: boolean): void {
  res.clearCookie(HANDSHAKE_COOKIE, { ...base(secure), path: "/api/auth/google" });
}
