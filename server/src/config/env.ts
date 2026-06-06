import { z } from "zod";

/** Google OAuth 2.0 web-client configuration (secret stays server-side). */
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/**
 * Everything the auth subsystem needs at runtime. Built from validated env
 * (see {@link loadEnv}) and injected into `createApp`, so tests can supply a
 * deterministic config instead of reading the real environment.
 */
export interface AuthConfig {
  /** Secret used to sign the ~1h access-token JWT and the short OAuth handshake JWT. */
  jwtSecret: string;
  google: GoogleConfig;
  /** When true, the env-gated POST /api/test/login seam is mounted (never in production). */
  testMode: boolean;
}

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_REDIRECT_URI: z.string().url("GOOGLE_REDIRECT_URI must be a valid URL"),
  AUTH_JWT_SECRET: z.string().min(16, "AUTH_JWT_SECRET must be at least 16 characters"),
  AUTH_TEST_MODE: z.string().optional(),
});

/**
 * Read and validate server configuration at startup. Throws (so the process refuses
 * to boot) if any required Google or JWT variable is missing or malformed. The
 * test-only `AUTH_TEST_MODE` is optional. Secrets are never logged.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AuthConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${details}`);
  }
  const env = parsed.data;
  return {
    jwtSecret: env.AUTH_JWT_SECRET,
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
    },
    testMode: env.AUTH_TEST_MODE === "1",
  };
}
