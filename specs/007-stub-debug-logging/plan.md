# Implementation Plan: Email Stub Debug Logging

**Branch**: `007-stub-debug-logging` | **Date**: 2026-06-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-stub-debug-logging/spec.md`

## Summary

Give the **email stub provider** an opt-in **debug log** so a developer running the app locally can
confirm, from the server console alone, that the four Email fields submitted on the test page
(recipient, subject, body, body format) reached the backend and were parsed correctly — without a
real email vendor and without a debugger.

The log is **off by default** and turned on with a single env var **`EMAIL_STUB_DEBUG=1`** (read
inline in `server.ts`, the same way `EMAIL_PROVIDER` already is). It is **stub-only** and lives in
`StubEmailProvider`, so it never touches the shared channel/dispatch path a future real provider
would use (FR-008). The stub already receives the message at the **provider boundary** — after
validation and, for HTML bodies, after server-side sanitization — so logging the `EmailMessage` it
is handed shows exactly what a real provider would receive (FR-004).

The change is intentionally tiny and KISS-aligned: extend `StubEmailProvider`'s constructor options
with `{ debug?, log? }`, use the existing (currently-ignored) `message` argument in `send()`, emit
one clearly-labelled debug line when enabled, and thread the flag from `server.ts` →
`createEmailProvider("stub", { debug })`. The injectable `log` keeps it unit-testable without
capturing the real console. This deliberately relaxes 005's FR-014 ("never log recipient or
content") **for the stub only, off by default, local-only**, and documents the trade-off.

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 (server); unchanged from 001–006. Server-only
feature — no client or `shared/` change.

**Primary Dependencies**: Existing only — no new runtime dependency. Uses the standard library
console for output and the existing `EmailProvider`/`EmailMessage` types and `StubEmailProvider`
class from 005.

**Storage**: None. No DB schema change, no persistence, no migration. The feature reads an env flag
and writes to the console.

**Testing**: Vitest (server unit). New unit tests on `StubEmailProvider`: (1) with `debug: true` and
an injected `log` spy, a `send(message)` emits one line containing recipient, subject, body, and the
derived body format; (2) with `debug` off/omitted, the `log` spy is never called; (3) the debug flag
does not change the returned `ProviderResult` (accept/fail behavior is identical with the log on or
off). Existing notification tests must stay green.

**Target Platform**: Linux server (Node process); local development is the primary context for this
feature.

**Project Type**: Web application (existing npm workspaces `client/`, `server/`, `shared/`); this
change is confined to `server/`.

**Performance Goals**: One synchronous console write per send when enabled; negligible. No change to
the existing local p95 < 200 ms target. When disabled, zero added work on the hot path beyond a
boolean check.

**Constraints**:
- Off by default; only `EMAIL_STUB_DEBUG=1` enables it (FR-002).
- When disabled, no recipient/subject/body is written to any log (FR-003).
- Log reflects the message at the provider boundary — post-validation, post-sanitization (FR-004).
- Additive only: no change to send outcome, validation, error handling, or test-page output
  (FR-005).
- Output is clearly labelled as debug; any truncation of large content must be explicit (FR-006).
- Behavior is limited to `StubEmailProvider`; the channel/dispatch path is untouched (FR-008).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Test-Driven Development (NON-NEGOTIABLE)** — PASS. New Vitest unit tests for the stub's
  enabled/disabled logging and outcome-invariance are written alongside the change; they run in CI
  and gate merge. The injectable `log` makes the behavior directly assertable.
- **II. Keep It Simple** — PASS. Smallest design that satisfies the spec: extend an existing class's
  options, reuse the already-passed `message`, one env flag read where `EMAIL_PROVIDER` is already
  read. No new file, dependency, layer, log framework, or config system. (A logging library or a
  general "debug config" object would be speculative and is rejected — see research D2.)
- **III. Typed End to End** — PASS. Server-side TypeScript; new options and the `send(message)`
  parameter use the existing explicit `EmailMessage`/`ProviderResult` types. No `any`, no unchecked
  assertions.
- **IV. Accessible by Default** — N/A. No UI change; the test page is unchanged (FR-005). No new
  user-facing surface to make accessible.
- **V. Small Pull Requests** — PASS. One narrowly-scoped feature: stub debug log + its env flag +
  tests + doc note. Independently mergeable; touches a handful of server files.

No violations — Complexity Tracking is not required.

## Project Structure

### Documentation (this feature)

```text
specs/007-stub-debug-logging/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── checklists/
│   └── requirements.md  # Spec quality checklist (/speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

No `contracts/` directory: this feature exposes **no new external interface** — no HTTP endpoint, no
request/response shape, no change to `contracts/openapi.yaml` or the generated `shared/src/api.ts`.
Its "contract" is an internal one (the `EMAIL_STUB_DEBUG` env flag + the console log format),
documented in `quickstart.md`.

### Source Code (repository root)

```text
server/
├── src/
│   ├── server.ts                                   # MODIFY: read EMAIL_STUB_DEBUG, pass {debug}
│   │                                               #   into createEmailProvider("stub", ...)
│   └── notifications/
│       └── channels/
│           └── email/
│               ├── stub-provider.ts                # MODIFY: add {debug?, log?} options; emit one
│               │                                   #   labelled debug line from send(message)
│               └── providers.ts                    # MODIFY: createEmailProvider(name, opts?) forwards
│                                                   #   {debug} to new StubEmailProvider(...)
└── tests/
    └── unit/
        └── stub-provider.test.ts                   # ADD/EXTEND: logs-when-enabled, silent-when-
                                                     #   disabled, outcome-invariant
```

`server/src/app.ts` is unchanged: its fallback `new StubEmailProvider()` (used by tests when no
provider is injected) keeps debug **off**, which is the correct default.

**Structure Decision**: Existing web-application layout (`client/`/`server/`/`shared/` workspaces).
This is a server-only change localized to the email stub and its composition root; no new
directories. README's Manual-setup env-var list is updated in the implementation commit (new env
var) per the README-maintenance rule.

## Complexity Tracking

No constitution violations — section intentionally empty.
