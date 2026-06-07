# Implementation Plan: Generic Notification System (Email)

**Branch**: `005-notifications-system` | **Date**: 2026-06-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-notifications-system/spec.md`

## Summary

Add a **single, generic notification-sending capability** that any part of the app can call with a
`{ channel, recipient, content }` request and get back an **explicit outcome** (sent, or failed with
a human-readable reason) — with **Email** as the only enabled channel in v1 and the structure ready
for WhatsApp/push later **without changing existing callers** (FR-001…FR-004, FR-009).

The design is two nested abstractions, each demanded by an explicit requirement:

1. A **channel registry** (FR-004, FR-011): the generic `notify()` dispatcher looks the requested
   channel up in a registry, rejects unknown/disabled channels with a clear "channel not supported"
   outcome, and routes known ones to a `NotificationChannel` handler. Only `email` is registered as
   sendable; `whatsapp`/`push` are listed as **known-but-unavailable** so the test page can show the
   extension point without allowing a send.
2. An **email-provider port** (the user's explicit "easy to change the external provider" goal): the
   `EmailChannel` validates Email-specific fields (recipient format, non-empty subject + body, size
   limits, plain-text/HTML format), sanitizes HTML server-side (FR-016), then hands a normalized
   `EmailMessage` to an injected **`EmailProvider`** interface. **No vendor is chosen now.** v1 wires
   a **`StubEmailProvider`** (no network send; returns a deterministic accepted/failed outcome) so the
   whole pipeline is exercisable and testable end-to-end; a real provider is a later, localized change
   — implement `EmailProvider` once and select it via env, touching no caller and no channel logic.

The recommended real providers are catalogued in **[email-providers.md](./email-providers.md)** (the
document the user asked for) and summarized as a deferred decision in research.md — to be chosen and
implemented in a future feature.

A new **UI test page** (`/notifications`, behind the existing `requireAuth`) lets a signed-in user
pick a channel, fill the channel's fields (Email: recipient, subject, body, format), send, and see the
outcome (FR-010…FR-013, FR-015). Two new endpoints back it: `GET /api/notifications/channels`
(availability + per-channel field descriptors, drives the dynamic form) and
`POST /api/notifications/test` (invokes the same generic capability callers use).

**No persistence**: v1 has no audit log/history and no DB tables (spec Assumptions); the outcome is
returned synchronously and shown once.

## Technical Context

**Language/Version**: TypeScript 5.6+ on Node.js 22 LTS (server) and React 18 (client) — unchanged
from 001–004.

**Primary Dependencies**: Express 5, Zod, React 18 + Vite 5 — all already present. **One new
dependency**: `sanitize-html` (server) to satisfy FR-016 (server-side HTML-body sanitization). **No
email-vendor SDK is added** — the concrete provider is deferred per the user's instruction; v1 ships
an in-process `StubEmailProvider`, so no new network/secret dependency enters now.

**Storage**: **None added.** v1 stores no notifications (no audit log — spec Assumptions). The
existing SQLite DB (`note`/`user`/`session`) is untouched.

**Testing**: Vitest (server unit + integration via Supertest; client via React Testing Library) and
Playwright e2e — the existing stack. New: unit tests for the dispatcher (routing, unsupported
channel), the Email channel (field validation, HTML sanitization, provider success/failure/timeout
mapping), and the stub provider; integration tests for `GET /channels` and `POST /test` (auth,
validation, outcome shapes); a client test for the test page (dynamic fields, outcome rendering,
a11y); an e2e that signs in, sends a stub email, and asserts the success outcome.

**Target Platform**: Linux server (Node process) + existing browser SPA, single-instance deploy.

**Project Type**: Web application (existing `shared/`, `server/`, `client/`, `e2e/` npm workspaces).

**Performance Goals**: The success path returns within the SC-001 5-second budget (the stub is
in-process and sub-millisecond); a stalled real provider is bounded by a **30-second hard timeout**
(clarified, FR-008), after which the call is aborted and reported as a timeout failure.

**Constraints**:
- Single request, single recipient, single channel per call — no batch/templating/scheduling/retry
  (spec Assumptions, KISS).
- Provider credentials/secrets are **server-side only**, never sent to the client, and recipient
  addresses / message bodies are **never logged** in a way that exposes them (FR-014).
- The provider is swappable behind one interface with **zero changes to callers** when replaced
  (FR-004, user goal); adding a channel is a registry entry plus one handler, again with no caller
  changes (SC-002, SC-003).
- Test page meets the accessibility baseline: semantic form, labelled controls, full keyboard
  operation, WCAG AA contrast, and an ARIA live region announcing the outcome (FR-015, Principle IV).

**Scale/Scope**: Small. New `server/src/notifications/` module (dispatcher + channel registry + email
channel + provider port + stub provider + Zod validation), two routes, a client page + nav entry,
contract additions, and the provider-recommendations document. No DB work.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | How this plan satisfies it |
|---|-----------|--------|----------------------------|
| I | Test-Driven Development (NON-NEGOTIABLE) | ✅ PASS | Tests written with/before code at every layer: **unit** — dispatcher routing + unsupported/disabled channel rejection; Email-channel validation (malformed email, empty subject/body, oversized subject>200/body>10000, format toggle) + HTML sanitization (scripts/unsafe markup stripped) + provider success/failure/timeout → outcome mapping; stub provider determinism. **integration (Supertest)** — `GET /api/notifications/channels` shape + availability; `POST /api/notifications/test` happy path (200 sent), validation (400, no send attempted), unsupported channel (400), provider failure (200 failed + reason), unauth (401). **client (RTL)** — test page renders Email fields, switches fields by channel, disables submit while sending, announces outcome. **e2e** — sign in → send stub email → success outcome shown. All wired into CI; merge blocked unless green. |
| II | Keep It Simple | ✅ PASS | The two abstractions are **required by explicit requirements, not speculative**: the channel registry by FR-001/FR-004/FR-011 (a *generic, extensible* system that visibly accounts for future channels) and the `EmailProvider` port by FR-004 + the user's explicit "easy to change the external provider" goal. Each is kept minimal — a registry with **one** sendable entry, a provider interface with **one** stub adapter. Deliberately **excluded** as YAGNI: no queue/retry, no templating, no scheduling, no audit-log table, no WhatsApp/push handlers, **no vendor SDK** (provider choice deferred). One new dependency (`sanitize-html`) is mandated by FR-016, not added speculatively. → Complexity Tracking left empty. |
| III | Typed End to End | ✅ PASS | New contract types (`NotificationChannelType`, `NotificationTestRequest`, `SendOutcome`, `ChannelInfo`) live in `contracts/openapi.yaml` and flow to both sides via the generated `shared/src/api.ts` (`npm run gen:api`), mirroring `Note`. Request bodies validated with Zod; the `EmailProvider` port, `EmailMessage`, and `ProviderResult` are explicitly typed; no `any`; `tsc --noEmit` in CI. |
| IV | Accessible by Default | ✅ PASS | The test page is a semantic `<form>` with `<label>`-associated controls, a native `<select>` for the channel (future channels shown disabled), keyboard-operable throughout, WCAG AA contrast (reusing existing tokens in `styles.css`), and an `aria-live` region announcing the send outcome and validation errors. |
| V | Small Pull Requests | ✅ PASS | Independently mergeable slices: (1) contracts + shared types + `notifications/` core (dispatcher, registry, Email channel, provider port, stub) + Zod + unit tests; (2) the two HTTP routes + integration tests; (3) client test page + nav + RTL test + e2e; (4) docs-only `email-providers.md`. Each reviewable in one sitting. |

**Merge gates** (constitution Development Workflow): a PR merges only when (1) tests + e2e pass,
(2) `tsc` type-check passes, and (3) the UI change meets the accessibility baseline.

**Result**: PASS. No violations requiring justification → Complexity Tracking left empty.

**Post-design re-check (after Phase 1)**: Still PASS. The dispatcher, registry, Email channel,
provider port, and stub add no abstraction beyond what FR-004 (extensibility) and the
swappable-provider goal demand; secrets stay server-side (none in v1), nothing sensitive is logged,
and no persistence is introduced. All five principles remain satisfied.

## Project Structure

### Documentation (this feature)

```text
specs/005-notifications-system/
├── plan.md              # This file (/speckit-plan output)
├── spec.md              # Feature specification (+ Clarifications session 2026-06-07)
├── research.md          # Phase 0 — decisions D1–D9 (incl. deferred provider choice)
├── data-model.md        # Phase 1 — in-memory types + validation rules (no DB tables)
├── email-providers.md   # Phase 1 — the requested catalogue of recommended email providers
├── quickstart.md        # Phase 1 — run, use the test page, add a real provider, test
├── contracts/
│   └── notifications-api.md  # Phase 1 — HTTP contract for /notifications/channels + /test
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root) — additions to the existing layout

```text
contracts/openapi.yaml            # ADD paths: GET /notifications/channels, POST /notifications/test;
                                  #   ADD schemas: NotificationChannelType, ChannelInfo, ChannelField,
                                  #   NotificationTestRequest, SendOutcome (source of truth for shared)

shared/src/api.ts                 # REGENERATED from openapi.yaml via `npm run gen:api` (no hand edits)

server/
├── src/
│   ├── app.ts                    # MOUNT requireAuth + createNotificationsRouter at /api/notifications
│   ├── config/
│   │   └── env.ts                # EXTEND: EMAIL_PROVIDER selector (default "stub"); future provider
│   │                             #   creds parsed here when a real adapter is added (server-side only)
│   ├── notifications/
│   │   ├── types.ts              # NEW: NotificationRequest, SendOutcome, Channel/ChannelInfo types
│   │   ├── notifier.ts           # NEW: generic notify() — registry lookup, unsupported-channel guard,
│   │   │                         #   route to channel handler (FR-001, FR-002, FR-009)
│   │   ├── registry.ts           # NEW: channel registry; email=available, whatsapp/push=unavailable
│   │   ├── validation.ts         # NEW: Zod schemas for the test request + per-channel field rules
│   │   └── channels/
│   │       └── email/
│   │           ├── email-channel.ts   # NEW: validate fields, sanitize HTML (FR-016), call provider,
│   │           │                      #   enforce 30s timeout, map result → SendOutcome
│   │           ├── provider.ts        # NEW: EmailProvider interface + EmailMessage/ProviderResult
│   │           └── stub-provider.ts   # NEW: default in-process provider (no network send)
│   └── routes/
│       └── notifications.ts      # NEW: GET /channels (availability + fields), POST /test (auth-gated)
└── tests/
    ├── unit/                     # notifier, registry, email-channel, validation, stub-provider
    └── integration/              # GET /channels, POST /test (auth, validation, outcomes)

client/
└── src/
    ├── App.tsx                   # ADD protected route /notifications + a nav link from the note page
    ├── api/
    │   └── notificationsClient.ts # NEW: getChannels(), sendTestNotification() (typed from shared)
    └── pages/
        └── NotificationsTestPage.tsx # NEW: channel selector, dynamic fields, format toggle,
                                       #   submit, accessible outcome region (FR-010..FR-013, FR-015)

e2e/
└── notifications-test-page.spec.ts # NEW: sign in → send stub email → assert success outcome
```

**Structure Decision**: Keep the existing web-app layout (npm workspaces). All server logic lives in
a cohesive new `server/src/notifications/` module: the generic `notifier` + `registry` are
channel-agnostic; everything Email-specific (field validation, sanitization, the provider port and
its stub) is isolated under `channels/email/`, so adding a channel means adding a sibling folder +
one registry entry — **no change to `notifier.ts` or any caller** (SC-002, SC-003). The provider is
injected into the Email channel (mirroring how the keyring is injected into the note router), so
swapping vendors later is a one-file adapter + an env switch. Contract types are authored in the root
`openapi.yaml` and consumed via the generated `shared/src/api.ts`, exactly like `Note`.

## Complexity Tracking

> No constitution violations — this section intentionally left empty. The channel registry and the
> `EmailProvider` port are each mandated by explicit requirements (FR-004 extensibility; the user's
> "easy to change the external provider" goal), and the single new dependency (`sanitize-html`) is
> mandated by FR-016 — none is speculative, so there is nothing to justify here.
