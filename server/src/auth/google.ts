import { randomBytes } from "node:crypto";
import { OAuth2Client, CodeChallengeMethod } from "google-auth-library";
import type { GoogleConfig } from "../config/env";
import type { GoogleProfile } from "../db/user-repo";

const SCOPES = ["openid", "email", "profile"];

export interface AuthRequest {
  /** Google authorization URL to redirect the browser to. */
  url: string;
  /** Opaque anti-CSRF value echoed back on the callback (D3). */
  state: string;
  /** PKCE code verifier, stored in the handshake cookie and used at exchange time. */
  codeVerifier: string;
}

/** Thin, mockable wrapper over the official Google client (D1). */
export interface GoogleAuth {
  /** Build a PKCE+state authorization URL for the consent screen. */
  createAuthRequest(): Promise<AuthRequest>;
  /** Exchange an authorization code (with its PKCE verifier) and verify the ID token. */
  exchangeCode(code: string, codeVerifier: string): Promise<GoogleProfile>;
}

export function createGoogleAuth(config: GoogleConfig): GoogleAuth {
  const client = new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });

  return {
    async createAuthRequest(): Promise<AuthRequest> {
      const state = randomBytes(16).toString("base64url");
      const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
      const url = client.generateAuthUrl({
        access_type: "online",
        scope: SCOPES,
        state,
        code_challenge_method: CodeChallengeMethod.S256,
        code_challenge: codeChallenge,
      });
      return { url, state, codeVerifier };
    },

    async exchangeCode(code: string, codeVerifier: string): Promise<GoogleProfile> {
      const { tokens } = await client.getToken({
        code,
        codeVerifier,
        redirect_uri: config.redirectUri,
      });
      const idToken = tokens.id_token;
      if (!idToken) {
        throw new Error("Google token response did not include an ID token");
      }
      const ticket = await client.verifyIdToken({ idToken, audience: config.clientId });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new Error("Google ID token is missing sub/email");
      }
      return { sub: payload.sub, email: payload.email, name: payload.name ?? null };
    },
  };
}
