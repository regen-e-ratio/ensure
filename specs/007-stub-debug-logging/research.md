# Research: Email Stub Debug Logging

Phase 0 decisions. The spec left no `[NEEDS CLARIFICATION]` markers; the items below resolve the
small design choices implied by the requirements, each against the constitution (esp. II — Keep It
Simple) and the existing 005 notification design.

## D1 — Where the debug log lives (stub vs. channel/dispatch)

**Decision**: Implement the log **inside `StubEmailProvider.send(message)`**, not in the Email
channel, `notifier.ts`, or any shared path.

**Rationale**: FR-008 requires the behavior be stub-only and never leak content logging into the
path a real provider would use. The stub is also the exact **provider boundary** (FR-004): by the
time `send(message)` is called, the channel has already validated fields and sanitized HTML bodies,
so the `EmailMessage` the stub holds is precisely what a real provider would receive. The stub's
`send` already accepts a `message` parameter (currently ignored) — using it requires no signature
change to the `EmailProvider` port.

**Alternatives considered**: (a) Log in the Email channel before calling the provider — rejected:
would also run for a future real provider, violating FR-008, and would log pre/post-sanitization
ambiguously. (b) Log in `notifier.ts`/dispatch — rejected: even further from the boundary and
applies to all channels.

## D2 — How the log is enabled (env flag vs. logging framework)

**Decision**: A single boolean env var **`EMAIL_STUB_DEBUG`** (`"1"` = on; anything else / unset =
off), **read inline in `server.ts`** next to `EMAIL_PROVIDER`, and passed down as a `debug: boolean`
option. No logging library, no log-level system, no central debug-config object.

**Rationale**: Keep It Simple (Principle II). The codebase already uses bare `"1"` env flags for
local-only seams — `NOTE_ALLOW_TEST_RESET=1` and `AUTH_TEST_MODE=1` — and reads operational toggles
like `EMAIL_PROVIDER` inline in `server.ts` rather than in the Zod env schema (per the existing
comment there). Matching that pattern keeps one consistent mental model and adds zero dependencies.
A logging framework or generalized debug config would be speculative abstraction for a single
local-debug line (YAGNI).

**Alternatives considered**: (a) Add to the Zod `env.ts` schema — rejected: that schema is for
**required** secrets that should fail the boot if malformed; an optional local toggle belongs inline
with `EMAIL_PROVIDER` (consistent with the existing code comment). (b) A `--debug` CLI flag —
rejected: env vars are how every other toggle here is set (`server/.env`). (c) `DEBUG=email:stub`
namespaced logger (the `debug` npm package) — rejected: new dependency for no real gain.

## D3 — What the log contains and its format

**Decision**: When enabled, emit **one** clearly-labelled line per send containing the four fields
the developer wants to verify: **recipient** (`message.to`), **subject**, **body**, and the
**body format** derived from the message shape (`html` set → `"html"`, else `"text"`). Prefix it so
it is unmistakably debug output, e.g. `[email-stub:debug] received { to, subject, bodyFormat, body }`.

**Rationale**: The feature's entire purpose (SC-001, FR-001) is letting the developer eyeball that
all four submitted fields arrived intact. The body format is not a stored field on `EmailMessage`;
it is unambiguously recoverable from which of `text`/`html` is set (the channel sets exactly one).
A single structured-ish line keeps it greppable and easy to read in the dev console.

**Alternatives considered**: (a) Log the raw pre-validation HTTP request body instead — rejected:
the spec (Assumptions) prefers the provider-boundary view, which is what a real provider would get
and reflects sanitization. (b) Multi-line pretty JSON — rejected: noisier in the console; a single
line is sufficient and easier to scan.

## D4 — Handling large bodies (truncation)

**Decision**: Log the **full** body. The Email channel already rejects bodies > 10,000 characters
(005 FR), so any body that reaches the stub is bounded and safe to print in full during local
debugging. **No truncation is applied.** If a future change introduces truncation, it MUST be marked
explicitly in the output (e.g. a `…[truncated N chars]` suffix) so the developer can tell whether
the full content arrived (FR-006).

**Rationale**: Simplest behavior that satisfies FR-006's "truncation, if any, must be explicit":
with no truncation, what is printed is exactly what arrived. The 10k cap means there is no console
or performance concern for a local debug line.

**Alternatives considered**: Truncate at e.g. 500 chars with a marker — rejected as unnecessary
complexity given the existing 10k cap, and it would partly defeat the goal of confirming the *full*
body arrived.

## D5 — Testability (avoiding real-console capture)

**Decision**: Make the sink **injectable**: `StubEmailProvider` accepts an optional
`log?: (line: string) => void` that **defaults to `console.debug`** (bound). Tests pass a spy and a
plain string log; production passes nothing and gets the console.

**Rationale**: Principle I (TDD, non-negotiable) needs the logging behavior asserted directly.
Injecting the sink lets unit tests verify "logs exactly one line containing each field when enabled"
and "never called when disabled" without monkey-patching `console`, which is brittle and can leak
across tests. This mirrors how 005 already injects the `EmailProvider` itself for testability.

**Alternatives considered**: Spy on the global `console` in tests — rejected: brittle, order-
dependent, and pollutes other tests' output expectations.

## D6 — Outcome invariance

**Decision**: The debug flag affects **only** logging. `send()` returns the same `ProviderResult` it
returns today (accept by default; fail when `behavior.accept === false`), regardless of `debug`.

**Rationale**: FR-005/SC-003 require the send outcome and test-page output be identical with the log
on or off. A dedicated unit test asserts the returned result is unchanged by the flag.

## Summary of choices

| # | Topic | Decision |
|---|-------|----------|
| D1 | Location | Inside `StubEmailProvider.send(message)` — provider boundary, stub-only |
| D2 | Enable switch | `EMAIL_STUB_DEBUG=1` env var, read inline in `server.ts`; off by default |
| D3 | Contents | One labelled line: recipient, subject, body, derived body format |
| D4 | Large bodies | Log full body (≤10k cap already enforced); truncation, if ever added, marked |
| D5 | Test seam | Injectable `log?` sink defaulting to `console.debug` |
| D6 | Outcome | Flag changes logging only; `ProviderResult` unchanged |
