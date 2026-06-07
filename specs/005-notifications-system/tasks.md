---
description: "Task list for Generic Notification System (Email)"
---

# Tasks: Generic Notification System (Email)

**Input**: Design documents from `/specs/005-notifications-system/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/notifications-api.md, quickstart.md

**Tests**: MANDATORY per Constitution Principle I (Test-Driven Development, NON-NEGOTIABLE). Test tasks
are written before/alongside the implementation they cover and must fail first.

**Organization**: Tasks are grouped by user story. The spec's stories are intentionally layered
(US2 "depends on P1 existing"; US3 "constrains the design"), so US2/US3 build on the engine created in
US1 rather than being fully orthogonal — see Dependencies.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)
- Exact file paths are included in every task.

## Path conventions

Existing npm-workspace web app: server logic under `server/src/`, server tests under `server/tests/`,
client under `client/src/`, Playwright under `e2e/`, the API contract at `contracts/openapi.yaml`
(source of truth for the generated `shared/src/api.ts`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and configuration the whole feature relies on.

- [X] T001 [P] Add `sanitize-html` and `@types/sanitize-html` to the server workspace in `server/package.json` (run `npm install` so the lockfile updates) — mandated by FR-016 (server-side HTML sanitization).
- [X] T002 [P] Add an optional `EMAIL_PROVIDER` variable (default `"stub"`) to the env schema and return value in `server/src/config/env.ts`, and document it in `server/.env.example` (server-side only; selects the email adapter).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The typed contract and shared types every story consumes.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [X] T003 Add the notification endpoints and schemas to `contracts/openapi.yaml`: paths `GET /notifications/channels` and `POST /notifications/test`; schemas `NotificationChannelType` (enum `email|whatsapp|push`), `ChannelField`, `ChannelInfo`, `ChannelsResponse`, `NotificationTestRequest`, `SendOutcome`, `SendOutcomeResponse` (all `additionalProperties: false`, reusing the existing `Error` schema) — per `contracts/notifications-api.md`.
- [X] T004 Regenerate the shared types with `npm run gen:api` (overwrites `shared/src/api.ts`) and re-export any convenience aliases from `shared/src/index.ts` if needed (depends on T003; no hand edits to the generated file).
- [X] T005 [P] Create `server/src/notifications/types.ts` with the dispatcher-facing `NotificationRequest` type and internal aliases re-using the generated `SendOutcome`/`ChannelInfo`/`NotificationChannelType` from `@ensure/shared/api`.

**Checkpoint**: Contract + shared types exist and type-check — story implementation can begin.

---

## Phase 3: User Story 1 - Send a notification through the system (Priority: P1) 🎯 MVP

**Goal**: An authenticated user opens the `/notifications` test page, selects Email, enters
recipient/subject/body and a format, sends, and sees an explicit success-or-failure outcome — proving
the generic capability works end to end through one channel (against the v1 stub provider).

**Independent Test**: Sign in, open `/notifications`, select Email, submit a valid recipient + subject
+ body → a success outcome is shown; submit a malformed email or empty/oversized field → a validation
message and no send; force the provider to fail (test config) → a failure outcome with a reason.

### Tests for User Story 1 (write first; must fail before implementation) ⚠️

- [X] T006 [P] [US1] Unit test the stub provider (accepts well-formed messages, returns a synthetic id; configurable failure path; logs no recipient/body) in `server/tests/unit/stub-provider.test.ts`.
- [X] T007 [P] [US1] Unit test request validation (valid email required; subject trimmed 1–200; body trimmed 1–10000; `bodyFormat` ∈ text|html; each failure → message, no send) in `server/tests/unit/notifications-validation.test.ts`.
- [X] T008 [P] [US1] Unit test the Email channel (valid send → `sent`; HTML body sanitized — `<script>`/event handlers/`javascript:` stripped before the provider; provider rejection → `failed` + reason; 30s timeout → `failed` timeout reason) in `server/tests/unit/email-channel.test.ts`.
- [X] T009 [P] [US1] Integration test `POST /api/notifications/test` (200 `{outcome:{status:"sent"}}`; 400 `VALIDATION_ERROR` with no delivery attempted; provider-failure → 200 `{outcome:{status:"failed",reason}}`; 401 when unauthenticated) in `server/tests/integration/notifications-test-endpoint.test.ts`.
- [X] T010 [P] [US1] Integration test `GET /api/notifications/channels` (Email present + `available:true` + its four fields; 401 when unauthenticated) in `server/tests/integration/notifications-channels.test.ts`.
- [X] T011 [P] [US1] Client test for the test page (renders Email fields, disables submit while sending, renders both success and failure outcomes, announces them via an `aria-live` region) in `client/src/pages/NotificationsTestPage.test.tsx`.
- [X] T012 [P] [US1] e2e: sign in (test-login) → open `/notifications` → send a stub email → assert the success outcome is shown, in `e2e/notifications-test-page.spec.ts`.

### Implementation for User Story 1

- [X] T013 [P] [US1] Define the `EmailProvider` port plus `EmailMessage` and `ProviderResult` types in `server/src/notifications/channels/email/provider.ts`.
- [X] T014 [P] [US1] Implement `StubEmailProvider` (no network send; `accepted:true` + synthetic `providerMessageId`; test-configurable failure; never logs recipient/body — FR-014) in `server/src/notifications/channels/email/stub-provider.ts`.
- [X] T015 [US1] Implement Zod validation for the test request and per-Email-field rules in `server/src/notifications/validation.ts` (FR-005, FR-006).
- [X] T016 [US1] Implement the Email channel in `server/src/notifications/channels/email/email-channel.ts`: validate fields, sanitize HTML when `bodyFormat==="html"` (FR-016), build `EmailMessage` (`text` xor `html`), call the injected provider under a 30s `AbortController`/`Promise.race` timeout (FR-008), and map `ProviderResult`→`SendOutcome` (FR-007). Depends on T013, T014, T015.
- [X] T017 [US1] Implement the channel registry registering Email as `available:true` with its `ChannelField[]` (recipient/subject/body/bodyFormat) in `server/src/notifications/registry.ts`. Depends on T016.
- [X] T018 [US1] Implement the generic `notify(request): Promise<SendOutcome>` dispatcher (registry lookup → route to the channel handler) in `server/src/notifications/notifier.ts` (FR-001, FR-002). Depends on T017.
- [X] T019 [US1] Implement the router (`GET /channels` → `{channels}` from the registry; `POST /test` → validate then `notify()`, returning 200 outcome / 400 validation) and select the provider from `EMAIL_PROVIDER` in `server/src/routes/notifications.ts`. Depends on T018.
- [X] T020 [US1] Mount `requireAuth` + the notifications router at `/api/notifications` in `server/src/app.ts` (FR-013). Depends on T019.
- [X] T021 [P] [US1] Implement the client API (`getChannels()`, `sendTestNotification()`, typed from `@ensure/shared/api`, reusing `apiFetch`) in `client/src/api/notificationsClient.ts`.
- [X] T022 [US1] Implement `NotificationsTestPage` (channel selector + Email fields driven by `GET /channels`, plain-text/HTML format toggle, submit disabled while sending, accessible `aria-live` outcome region, labelled controls — FR-010, FR-012, FR-015) in `client/src/pages/NotificationsTestPage.tsx`. Depends on T021.
- [X] T023 [US1] Add a protected `/notifications` route and a nav link from the note page in `client/src/App.tsx` (FR-013). Depends on T022.

**Checkpoint**: US1 fully functional — the test page sends through the generic capability and reports an explicit outcome.

---

## Phase 4: User Story 2 - Reuse the capability from anywhere (Priority: P2)

**Goal**: Any caller (not just the test page) can invoke the same generic `notify()` with
`{channel, recipient, content}` and get identical delivery + outcome behavior, with unsupported
channels rejected explicitly rather than failing silently.

**Independent Test**: From a unit/integration test (a stand-in for "a second part of the system"),
call `notify()` directly with channel=Email and observe the same `SendOutcome` as the endpoint path;
call it with an unsupported channel and observe a clear `CHANNEL_NOT_SUPPORTED` failure.

### Tests for User Story 2 (write first; must fail before implementation) ⚠️

- [X] T024 [P] [US2] Unit test: calling `notify()` directly (no HTTP) with channel=Email produces the same `SendOutcome` as the route path, with no channel-specific code in the caller (FR-001, SC-002), in `server/tests/unit/notifier-reuse.test.ts`.
- [X] T025 [P] [US2] Unit test: `notify()` with an unknown or `available:false` channel returns `{status:"failed", reason: CHANNEL_NOT_SUPPORTED}` and invokes no handler (FR-009), in `server/tests/unit/notifier-unsupported.test.ts`.

### Implementation for User Story 2

- [X] T026 [US2] Add the unsupported/disabled-channel branch to `notify()` (unknown type or `available:false` → `failed` `CHANNEL_NOT_SUPPORTED`, no handler call) in `server/src/notifications/notifier.ts`.
- [X] T027 [US2] Map a `CHANNEL_NOT_SUPPORTED` outcome from a disabled channel to a `400` `{error:"CHANNEL_NOT_SUPPORTED", message}` in `POST /test` in `server/src/routes/notifications.ts` (FR-009).

**Checkpoint**: US1 and US2 both work — the capability is uniformly reusable and rejects unsupported channels cleanly.

---

## Phase 5: User Story 3 - Ready to extend to new channels (Priority: P3)

**Goal**: The system and test page visibly account for future channels (WhatsApp, push): they appear
as **unavailable** (cannot be selected to send), and the page adapts its fields to the selected
channel — establishing the per-channel pattern without building those channels.

**Independent Test**: `GET /channels` lists WhatsApp and push as `available:false`; on the page they
appear disabled and cannot be sent; selecting Email shows exactly its fields (recipient, subject,
body, format).

### Tests for User Story 3 (write first; must fail before implementation) ⚠️

- [X] T028 [P] [US3] Integration test: `GET /api/notifications/channels` also lists `whatsapp` and `push` with `available:false` (FR-011) in `server/tests/integration/notifications-channels-extensibility.test.ts`.
- [X] T029 [P] [US3] Integration test: `POST /api/notifications/test` targeting a disabled channel (e.g. `whatsapp`) returns `400 CHANNEL_NOT_SUPPORTED` with no delivery attempted, in `server/tests/integration/notifications-disabled-channel.test.ts`.
- [X] T030 [P] [US3] Client test: unavailable channels render disabled in the selector and selecting a channel adapts the visible fields (FR-011, FR-012), extending `client/src/pages/NotificationsTestPage.test.tsx`.

### Implementation for User Story 3

- [X] T031 [US3] Register `whatsapp` and `push` as descriptor-only, `available:false` entries in `server/src/notifications/registry.ts` (no send handler).
- [X] T032 [US3] Render all channels in the selector with unavailable ones disabled and fields adapting to the selected channel's descriptors in `client/src/pages/NotificationsTestPage.tsx` (FR-011, FR-012).

**Checkpoint**: All three stories independently functional; the extension point is visible and non-sendable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Docs, accessibility verification, and full-suite validation across stories.

- [X] T033 [P] Update `README.md` — Architecture (the notification subsystem + provider port + test page; no external email service provisioned yet), Run (the `/notifications` page), and Manual setup (`EMAIL_PROVIDER`, default `stub`) — in the same commit as the implementation.
- [X] T034 [P] Verify the test page meets the accessibility baseline (keyboard-only operation, `<label>`-associated controls, WCAG AA contrast, focus states, live outcome region) on `client/src/pages/NotificationsTestPage.tsx` (FR-015, Principle IV).
- [X] T035 Run quickstart validation — `npm test`, `npm run typecheck`, `npm run lint`, `npm run test:e2e` — per `specs/005-notifications-system/quickstart.md`, and fix any gaps.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **blocks all stories** (contract + shared types).
- **US1 (Phase 3)**: depends on Foundational. This is the MVP and builds the shared engine
  (provider port, stub, Email channel, registry, `notify()`, routes, page).
- **US2 (Phase 4)**: depends on US1 (extends `notify()` + the route). The spec states US2 "depends on
  P1 existing."
- **US3 (Phase 5)**: depends on US1 (extends the registry + the page). Independent of US2.
- **Polish (Phase 6)**: depends on the desired stories being complete.

### Within each story

- Tests written first and failing before implementation (Principle I).
- Provider port + stub → Email channel → registry → `notify()` → routes → `app.ts` (server chain).
- Client API → page → route/nav (client chain).

### Parallel opportunities

- Setup: T001, T002 in parallel.
- Foundational: T005 can start once T003/T004 land (T003→T004 are sequential, same/derived files).
- US1 tests T006–T012 all in parallel; implementation T013 + T014 in parallel; T021 (client API) in
  parallel with the server chain.
- US2 tests T024, T025 in parallel. US3 tests T028–T030 in parallel.
- Once US1 is done, US2 and US3 can proceed in parallel (different files: notifier/route vs
  registry/page — coordinate the two small registry/notifier touch-points).

---

## Parallel Example: User Story 1

```bash
# Tests first (all parallel — distinct files):
Task: "Unit test stub provider in server/tests/unit/stub-provider.test.ts"
Task: "Unit test validation in server/tests/unit/notifications-validation.test.ts"
Task: "Unit test Email channel in server/tests/unit/email-channel.test.ts"
Task: "Integration test POST /test in server/tests/integration/notifications-test-endpoint.test.ts"
Task: "Integration test GET /channels in server/tests/integration/notifications-channels.test.ts"
Task: "Client test in client/src/pages/NotificationsTestPage.test.tsx"
Task: "e2e in e2e/notifications-test-page.spec.ts"

# Then the independent implementation leaves in parallel:
Task: "EmailProvider port in server/src/notifications/channels/email/provider.ts"
Task: "StubEmailProvider in server/src/notifications/channels/email/stub-provider.ts"
Task: "Client API in client/src/api/notificationsClient.ts"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP and validate**: the `/notifications`
page sends an Email through the generic capability and shows an explicit outcome (against the stub).
Demo-able as the MVP.

### Incremental delivery

1. Setup + Foundational → engine-ready contract/types.
2. US1 → MVP send path + test page (deploy/demo).
3. US2 → reuse guarantee + unsupported-channel rejection (deploy/demo).
4. US3 → visible extension point + dynamic per-channel fields (deploy/demo).
5. Polish → README, a11y verification, full-suite run.

### Notes

- The concrete email vendor is **not** implemented here (deferred per the plan + `email-providers.md`);
  US1 runs against `StubEmailProvider`. Adding a real provider later is a single `EmailProvider`
  adapter + an `EMAIL_PROVIDER` switch, touching no caller (see `quickstart.md`).
- [P] = different files, no incomplete dependency. Commit after each task or logical group.
- Keep provider/channel code free of recipient/body logging (FR-014) throughout.
