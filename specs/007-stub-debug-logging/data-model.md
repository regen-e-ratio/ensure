# Data Model: Email Stub Debug Logging

This feature introduces **no persisted data** — no database table, column, migration, or stored
entity. There is nothing to add to `server/src/db/index.ts`. The only "model" elements are an
in-memory config option and the existing message shape the log reads. They are documented here for
completeness.

## Config option (in-memory, not persisted)

### `StubEmailProvider` options (extended)

The existing constructor options gain two optional fields. Source of truth: the `EMAIL_STUB_DEBUG`
env var, read once at startup in `server.ts`.

| Field | Type | Required | Default | Meaning |
|-------|------|----------|---------|---------|
| `accept` | `boolean` | no | `true` | (existing) When `false`, every send fails — exercises the failure path. |
| `reason` | `string` | no | — | (existing) Failure reason used when `accept === false`. |
| `debug` | `boolean` | no | `false` | **New.** When `true`, each `send()` emits one debug line with the received fields (FR-001, FR-002). Off by default (FR-003). |
| `log` | `(line: string) => void` | no | `console.debug` (bound) | **New.** Injectable sink for the debug line — lets unit tests assert output without touching the real console (research D5). |

**Validation / rules**:
- `debug` is sourced only from `EMAIL_STUB_DEBUG === "1"`; any other value (including unset) → `false`
  (FR-002). No other code path sets it on.
- When `debug` is `false`, `log` is never invoked → no recipient/subject/body reaches any sink
  (FR-003).
- These options apply only to `StubEmailProvider`; the `EmailProvider` port and all other providers
  are unaffected (FR-008).

## Read-only input: `EmailMessage` (existing, unchanged)

The debug line is derived entirely from the `EmailMessage` the stub already receives at the provider
boundary (post-validation, post-sanitization). No field is added or modified.

| Field | Type | Used in log as | Notes |
|-------|------|----------------|-------|
| `to` | `string` | recipient | The validated recipient address. |
| `subject` | `string` | subject | Non-empty (channel-enforced). |
| `text` | `string?` | body (when set) | Present when body format = text. |
| `html` | `string?` | body (when set) | Present when body format = html; already **sanitized** by the channel. |
| *(derived)* | — | body format | `html` set → `"html"`, else `"text"`. Not a stored field; recomputed for the log (research D3). |

Exactly one of `text`/`html` is set by the channel, so the body and its format are unambiguous.

## State & lifecycle

None. The flag is fixed at process startup; the log is a stateless side effect of each `send()`. No
state transitions, no retention, no cleanup.
