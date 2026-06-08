---
description: "Task list for Email Stub Debug Logging"
---

# Tasks: Email Stub Debug Logging

**Input**: Design documents from `/specs/007-stub-debug-logging/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: MANDATORY per Constitution Principle I (Test-Driven Development, NON-NEGOTIABLE). Each
story's unit tests are written FIRST and must FAIL before the implementation task that makes them
pass.

**Organization**: Tasks are grouped by the two user stories from spec.md (US1 = log fires when
enabled; US2 = silent + off by default).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 (setup, foundational, and polish tasks carry no story label)

## Path Conventions

Web-app layout (npm workspaces). This is a **server-only** change. All paths are repo-relative:
- Implementation: `server/src/notifications/channels/email/`, `server/src/server.ts`
- Tests: `server/tests/unit/`

> ⚠️ **Single-file hotspot**: US1 and US2 both modify
> `server/src/notifications/channels/email/stub-provider.ts` and its test
> `server/tests/unit/stub-provider.test.ts`. Tasks touching the same file are **not** marked `[P]`
> and must run sequentially even though the stories are conceptually independent.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the change surface; no scaffolding or dependencies are required.

- [X] T001 Confirm no new dependency is needed and identify the change surface: `StubEmailProvider`
  in `server/src/notifications/channels/email/stub-provider.ts`, the factory
  `server/src/notifications/channels/email/providers.ts`, the composition root
  `server/src/server.ts`, and the existing test `server/tests/unit/stub-provider.test.ts` (extend,
  don't create). Verify `npm test --workspace server` is green before starting.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared, non-behavioral seam both stories build on.

**⚠️ CRITICAL**: Complete before US1/US2 implementation.

- [X] T002 Extend `StubEmailProvider` options in
  `server/src/notifications/channels/email/stub-provider.ts`: add `debug?: boolean` (default
  `false`) and `log?: (line: string) => void` (default `console.debug` bound) to the constructor
  options object, stored as private fields. **No emission yet** — this only establishes the typed
  seam and the off-by-default + injectable-sink defaults (data-model.md). Existing behavior
  (`accept`/`reason` and the returned `ProviderResult`) is unchanged.

**Checkpoint**: Typed `{ debug, log }` options exist and default to off; `npm run typecheck` passes.

---

## Phase 3: User Story 1 - Confirm submitted Email fields reach the backend (Priority: P1) 🎯 MVP

**Goal**: With the debug log enabled, each Email send emits one labelled console line showing the
recipient, subject, body, and derived body format the backend received at the provider boundary.

**Independent Test**: Set `EMAIL_STUB_DEBUG=1`, start the server, send one Email from the test page,
and confirm a single `[email-stub:debug]` line in the server console contains the four submitted
fields (matching exactly; HTML bodies appear sanitized).

### Tests for User Story 1 (write first, must FAIL)

- [X] T003 [US1] Add failing unit tests in `server/tests/unit/stub-provider.test.ts`: with
  `debug: true` and an injected `log` spy, `send(message)` (a) calls the spy exactly once,
  (b) the logged line contains `message.to`, the subject, and the body, (c) it reports
  `bodyFormat: 'text'` for a text message and `bodyFormat: 'html'` for an html message, and (d) for
  an html message the logged body is the (already-sanitized) `message.html` value passed in.
  (research.md D3) Also assert the line is prefixed so it is identifiable as debug output (FR-006).

### Implementation for User Story 1

- [X] T004 [US1] Implement the emission in `StubEmailProvider.send(message)` in
  `server/src/notifications/channels/email/stub-provider.ts`: use the (currently-ignored) `message`
  parameter; when `debug` is true, call `log` once with a single clearly-labelled line
  (e.g. `[email-stub:debug] received {...}`) containing recipient (`message.to`), subject, body, and
  the body format derived from which of `message.text`/`message.html` is set. Log the full body (no
  truncation — bodies are ≤10k by validation; research.md D4). Makes T003 pass. (FR-001, FR-004,
  FR-006, FR-008)
- [X] T005 [US1] Thread the flag through the factory in
  `server/src/notifications/channels/email/providers.ts`: change `createEmailProvider(name)` to
  `createEmailProvider(name, opts?: { debug?: boolean })` and forward `{ debug }` into
  `new StubEmailProvider({ debug: opts?.debug })` for the `"stub"` case. Unknown-name behavior
  unchanged.
- [X] T006 [US1] Enable end-to-end in `server/src/server.ts`: read `EMAIL_STUB_DEBUG` inline next to
  `EMAIL_PROVIDER` and pass `createEmailProvider(process.env.EMAIL_PROVIDER ?? "stub", { debug:
  process.env.EMAIL_STUB_DEBUG === "1" })`. Only the exact value `"1"` enables it. (FR-002,
  research.md D2)

**Checkpoint**: US1 tests pass; setting `EMAIL_STUB_DEBUG=1` produces the debug line on send, with
no change to the send outcome shown on the test page (acceptance scenario US1-3).

---

## Phase 4: User Story 2 - Keep the debug log off by default (Priority: P2)

**Goal**: With no opt-in, no recipient/subject/body is ever written to the logs, and the flag is off
on a fresh checkout.

**Independent Test**: With `EMAIL_STUB_DEBUG` unset, send an Email and confirm zero log lines contain
the recipient, subject, or body.

### Tests for User Story 2 (write first, must FAIL or guard against regression)

- [X] T007 [US2] Add failing/guarding unit tests in `server/tests/unit/stub-provider.test.ts`: with
  `debug` omitted (and with `debug: false`) and an injected `log` spy, `send(message)` never calls
  the spy (FR-003); and the returned `ProviderResult` is identical whether `debug` is on or off for
  both the accept and `accept: false` paths (outcome invariance, FR-005 / SC-003).

### Implementation for User Story 2

- [X] T008 [US2] Confirm and lock the off-by-default paths: verify the fallback
  `new StubEmailProvider()` in `server/src/app.ts:53` constructs the stub with `debug` off (no change
  expected) and that `server/src/server.ts` only sets `debug: true` for `EMAIL_STUB_DEBUG === "1"`.
  Add a brief code comment at the stub option (in `stub-provider.ts`) noting the content log is
  opt-in/local-debug-only so future readers don't widen it. (FR-002, FR-003, FR-008)

**Checkpoint**: Both stories pass; the stub is silent and outcome-identical when the flag is unset,
and reveals all four fields only when explicitly enabled.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and verification that span both stories. Lands in the **same PR/commit**
as the implementation (README-maintenance rule).

- [X] T009 Update `README.md` Manual-setup env-var section to document `EMAIL_STUB_DEBUG`: purpose
  (debug log on the email stub), default (off), accepted value (`1`), and an explicit note that
  enabling it writes recipient + message content to the server console and is **local-debugging
  only** (FR-007). Place it alongside the existing `EMAIL_PROVIDER` entry (README.md ~line 180).
- [X] T010 Run the `quickstart.md` validation manually: set `EMAIL_STUB_DEBUG=1`, `npm run
  dev:server` + `npm run dev:client`, send a text and an html Email from `/notifications`, and
  confirm one debug line per send with the correct four fields (html shows sanitized body); then
  unset the flag and confirm silence. (SC-001, SC-002)
- [X] T011 [P] Run the merge gates: `npm test --workspace server` (incl. the new stub tests and the
  existing notification suite), `npm run typecheck`, and `npm run lint` — all green.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks US1 and US2** (both need the `{ debug, log }`
  seam).
- **US1 (Phase 3)**: Depends on Foundational. Delivers the MVP (the actual debug log).
- **US2 (Phase 4)**: Depends on Foundational. Its tests (T007) are independent of US1, but because
  they live in the **same test file** as T003 and the off-path is the complement of T004's gate,
  run US2 after US1 to avoid edit conflicts and to assert against the finished `send()` logic.
- **Polish (Phase 5)**: Depends on US1 + US2 complete.

### Within Each User Story

- Tests (T003 for US1, T007 for US2) are written FIRST and must fail before the implementation task.
- US1: T003 → T004 → T005 → T006 (T004 in `stub-provider.ts`; T005 in `providers.ts`; T006 in
  `server.ts`).
- US2: T007 → T008.

### Parallel Opportunities

- Very limited — this is a small, single-hotspot change.
- T005 (`providers.ts`) and T006 (`server.ts`) touch **different files** from T004 (`stub-provider.ts`)
  and could be `[P]` relative to each other, but both depend on the option seam (T002) and the
  emission (T004) being in place to be meaningful end-to-end, so they are listed sequentially.
- T011 (gates) is `[P]` in that the three commands can run concurrently.
- US1 and US2 must **not** be edited in parallel: they share `stub-provider.ts` and
  `stub-provider.test.ts`.

---

## Parallel Example

```bash
# Polish gates can run concurrently (T011):
npm test --workspace server
npm run typecheck
npm run lint
```

(No story-level parallelism is recommended here — the work is concentrated in one provider file.)

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → Phase 2 Foundational (the `{ debug, log }` seam).
2. Phase 3 US1: tests-first, then emission + wiring (`stub-provider.ts` → `providers.ts` →
   `server.ts`).
3. **STOP and VALIDATE**: `EMAIL_STUB_DEBUG=1`, send an Email, confirm the debug line. This alone
   delivers the user's goal (verify front-end → backend field arrival).

### Incremental Delivery

1. Foundational ready → US1 (MVP, the log works when enabled) → demo.
2. US2 (lock off-by-default + outcome invariance) → demo.
3. Polish (README + quickstart validation + gates) → merge.

Because the whole feature is one small PR (Principle V), in practice all phases land together; the
ordering above is the safe build/verify sequence.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- The two stories share `stub-provider.ts` / `stub-provider.test.ts` — keep edits sequential.
- Verify each story's tests fail before implementing (TDD, Principle I).
- README update (T009) ships in the same commit as the code (README-maintenance rule).
- No DB, no HTTP contract, no client change — see plan.md / data-model.md.
