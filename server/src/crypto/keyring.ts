import { KEY_BYTES } from "./note-cipher";

/**
 * A single application-wide, *versioned* encryption secret, supplied via env and held
 * only in process memory (data-model.md "Encryption Keyring"). Any present version can
 * decrypt; only the active version encrypts new/updated notes. Coexisting versions are
 * what make non-disruptive rotation possible (FR-010, FR-011). Secrets live only here —
 * never in the DB, never sent to clients, never logged (FR-016).
 */
export type KeyVersion = number;

export interface Keyring {
  /** Version used to encrypt new/updated notes. */
  getActiveVersion(): KeyVersion;
  /** 32-byte key for `version`; throws if the version is unknown. */
  getKey(version: KeyVersion): Buffer;
  /** All versions available for decryption. */
  listVersions(): KeyVersion[];
  /** Whether `version` is present (used by the read path to fail closed). */
  hasVersion(version: KeyVersion): boolean;
}

/**
 * Parse and validate the env keyring, failing closed on any violation (FR-015). Error
 * messages reference only versions and byte-lengths — never key material (FR-016).
 *
 * @param keysSpec   `NOTE_ENC_KEYS` — comma-separated `version:base64key` entries.
 * @param activeSpec `NOTE_ENC_ACTIVE_VERSION` — integer; MUST appear in `keysSpec`.
 */
export function createKeyring(keysSpec: string, activeSpec: string): Keyring {
  const keys = new Map<KeyVersion, Buffer>();

  const entries = keysSpec
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    throw new Error("NOTE_ENC_KEYS must contain at least one version:key entry");
  }

  for (const entry of entries) {
    const sep = entry.indexOf(":");
    if (sep <= 0) {
      throw new Error(`NOTE_ENC_KEYS entry is not in "version:base64key" form`);
    }
    const version = parseVersion(entry.slice(0, sep), "NOTE_ENC_KEYS");
    if (keys.has(version)) {
      throw new Error(`NOTE_ENC_KEYS has a duplicate version ${version}`);
    }
    const key = Buffer.from(entry.slice(sep + 1), "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(`NOTE_ENC_KEYS key for version ${version} must decode to ${KEY_BYTES} bytes`);
    }
    keys.set(version, key);
  }

  const activeVersion = parseVersion(activeSpec, "NOTE_ENC_ACTIVE_VERSION");
  if (!keys.has(activeVersion)) {
    throw new Error(`NOTE_ENC_ACTIVE_VERSION ${activeVersion} is not present in NOTE_ENC_KEYS`);
  }

  return {
    getActiveVersion: () => activeVersion,
    getKey: (version) => {
      const key = keys.get(version);
      if (!key) {
        throw new Error(`no key available for version ${version}`);
      }
      return key;
    },
    listVersions: () => [...keys.keys()].sort((a, b) => a - b),
    hasVersion: (version) => keys.has(version),
  };
}

function parseVersion(raw: string, field: string): KeyVersion {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${field} version must be a positive integer`);
  }
  const version = Number(trimmed);
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error(`${field} version must be a positive integer`);
  }
  return version;
}
