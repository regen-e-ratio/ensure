import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { components } from "@ensure/shared/api";

export type AuthUser = components["schemas"]["User"];

/** Access-token lifetime (~1h) per FR-016. */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** OAuth handshake (state + PKCE verifier) lifetime — seconds, not minutes. */
export const HANDSHAKE_TTL_SECONDS = 10 * 60;

/** Payload stored in the short-lived OAuth handshake JWT. */
export interface HandshakePayload {
  state: string;
  codeVerifier: string;
  next?: string;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Sign a stateless access-token JWT for `user`, expiring in ~1h. The token is
 * verified on every protected request and is never stored server-side.
 */
export async function signAccessToken(
  user: AuthUser,
  secret: string,
  ttlSeconds: number = ACCESS_TOKEN_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name ?? null })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}

/**
 * Verify an access-token JWT. Returns the user on success, or null when the token
 * is missing, tampered, or expired (the caller maps null → 401).
 */
export async function verifyAccessToken(token: string, secret: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return null;
    }
    const name = payload.name;
    return {
      id: payload.sub,
      email: payload.email,
      name: typeof name === "string" ? name : null,
    };
  } catch {
    return null;
  }
}

/** Sign a short-lived JWT carrying the in-flight OAuth state + PKCE verifier (D3). */
export async function signHandshake(payload: HandshakePayload, secret: string): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${HANDSHAKE_TTL_SECONDS}s`)
    .sign(key(secret));
}

/** Verify and decode the OAuth handshake JWT, or null when invalid/expired. */
export async function verifyHandshake(
  token: string,
  secret: string,
): Promise<HandshakePayload | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    if (typeof payload.state !== "string" || typeof payload.codeVerifier !== "string") {
      return null;
    }
    return {
      state: payload.state,
      codeVerifier: payload.codeVerifier,
      next: typeof payload.next === "string" ? payload.next : undefined,
    };
  } catch {
    return null;
  }
}

/** Generate an opaque refresh token (raw value handed to the client, never stored). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hash (hex) of a refresh token — only the hash is persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Random opaque identifier for a session row. */
export function generateSessionId(): string {
  return randomBytes(16).toString("base64url");
}
