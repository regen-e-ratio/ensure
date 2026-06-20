import { z } from "zod";
import { createKeyring, type Keyring } from "../crypto/keyring";

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

/**
 * Runtime configuration for the dead-man liveness engine (feature 008). All vars are
 * optional with safe defaults; the in-process timer is disabled when `DEADMAN_TICK_DISABLED=1`
 * (tests, or when an external cron drives the engine), and the fast-forward test seam is
 * mounted only when `DEADMAN_TEST_MODE=1`. No secret is involved, so nothing here is logged.
 */
export interface DeadmanConfig {
  /** In-process tick interval (ms). Default 60000. */
  tickMs: number;
  /** When true (DEADMAN_TICK_DISABLED=1), the in-process timer never starts. */
  tickDisabled: boolean;
  /** Absolute base URL used to build links placed in emails. Default http://localhost:5173. */
  appBaseUrl: string;
  /** When true (DEADMAN_TEST_MODE=1), the POST /api/test/deadman fast-forward seam is mounted. */
  testMode: boolean;
}

/** Default in-process tick interval, in milliseconds (FR-015). */
const DEFAULT_DEADMAN_TICK_MS = 60000;
/** Default absolute base URL used to build email links. */
const DEFAULT_APP_BASE_URL = "http://localhost:5173";

/**
 * Read the dead-man engine configuration from env (alongside where EMAIL_PROVIDER is
 * read in server.ts). All vars are optional; a non-numeric `DEADMAN_TICK_MS` falls back
 * to the default rather than crashing the boot.
 */
export function loadDeadmanConfig(source: NodeJS.ProcessEnv = process.env): DeadmanConfig {
  const rawTick = Number(source.DEADMAN_TICK_MS);
  const tickMs = Number.isInteger(rawTick) && rawTick > 0 ? rawTick : DEFAULT_DEADMAN_TICK_MS;
  return {
    tickMs,
    tickDisabled: source.DEADMAN_TICK_DISABLED === "1",
    appBaseUrl: source.APP_BASE_URL ?? DEFAULT_APP_BASE_URL,
    testMode: source.DEADMAN_TEST_MODE === "1",
  };
}

const encryptionSchema = z.object({
  NOTE_ENC_KEYS: z.string().min(1, "NOTE_ENC_KEYS is required"),
  NOTE_ENC_ACTIVE_VERSION: z.string().min(1, "NOTE_ENC_ACTIVE_VERSION is required"),
});

/**
 * Read and validate the encryption keyring from env, building a {@link Keyring}.
 * Throws (so the process refuses to boot — fail closed, FR-015) if the variables are
 * missing or the keyring is malformed (key not 32 bytes, active version absent, …).
 * Errors reference only versions/byte-lengths, never key material (FR-016). Mirrors
 * the `AUTH_JWT_SECRET` handling so operators have one consistent secret model.
 */
export function loadEncryption(source: NodeJS.ProcessEnv = process.env): Keyring {
  const parsed = encryptionSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${details}`);
  }
  try {
    return createKeyring(parsed.data.NOTE_ENC_KEYS, parsed.data.NOTE_ENC_ACTIVE_VERSION);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid encryption keyring";
    throw new Error(`Invalid server configuration: ${message}`);
  }
}
