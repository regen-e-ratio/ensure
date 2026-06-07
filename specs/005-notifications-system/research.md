# Phase 0 Research: Generic Notification System (Email)

Decisions that resolve the plan's open points. Format per decision: **Decision / Rationale /
Alternatives considered**.

## D1 — Generic capability shape: a `notify(request)` dispatcher over a channel registry

**Decision**: Expose one server-side function, `notify(request: NotificationRequest): Promise<SendOutcome>`,
that looks `request.channel` up in a **channel registry** and delegates to the matching
`NotificationChannel` handler. Unknown or disabled channels return a `failed` outcome with reason
`CHANNEL_NOT_SUPPORTED` (no handler is invoked). Callers never import a channel directly.

**Rationale**: This is the literal FR-001/FR-002/FR-004/FR-009 requirement — a single uniform entry
point, channel chosen by data, extensible by adding handlers, with no channel-specific code in
callers. A registry (a `Map<ChannelType, NotificationChannel>`) is the smallest thing that delivers
it.

**Alternatives considered**: (a) One function per channel (`sendEmail`, …) — fails FR-002/FR-004
(callers must know channels; adding one changes callers). (b) A class hierarchy / DI container —
unjustified ceremony for one channel (Principle II).

## D2 — Channel abstraction boundary: `NotificationChannel` interface

**Decision**: `interface NotificationChannel { readonly type; readonly available: boolean; readonly
fields: ChannelField[]; send(request): Promise<SendOutcome> }`. The Email channel implements it;
`whatsapp`/`push` are represented as **descriptor-only, `available: false`** entries (they expose
`fields` for display but throw/return-unsupported if `send` is reached).

**Rationale**: One interface lets the dispatcher stay channel-agnostic and lets `GET
/notifications/channels` enumerate availability + fields for the dynamic UI (FR-011, FR-012). Keeping
future channels as availability flags (not real handlers) honors "visibly accounted for but cannot
send" (US3) without building them (YAGNI).

**Alternatives considered**: Hard-coding the channel list in the client — duplicates truth, breaks
SC-003 (UI would need editing to reflect a new channel). Rejected.

## D3 — Email provider boundary: an `EmailProvider` port, vendor **deferred**

**Decision**: Define `interface EmailProvider { send(message: EmailMessage): Promise<ProviderResult> }`
with `EmailMessage = { to, subject, html?, text? }` and `ProviderResult = { accepted: boolean;
providerMessageId?: string; reason?: string }`. The Email channel depends only on this port. **No
concrete vendor is selected in this feature.** Selection + a real adapter are a future change.

**Rationale**: This is the user's explicit instruction — "make our system built in a way that is easy
to change the external provider … we will choose and implement the external email provider in the
future." A narrow port (one method) means a future adapter is a single file wired by env, with zero
changes to the channel, the dispatcher, or any caller (FR-004, SC-002, SC-003). The catalogue of
recommended vendors is **[email-providers.md](./email-providers.md)**.

**Alternatives considered**: (a) Pick a vendor now (e.g. Resend/SES) — explicitly out of scope per the
user. (b) Add `nodemailer` now as a provider-agnostic SMTP transport — tempting (one adapter fits any
SMTP host), but it is still "implementing the provider," which the user deferred; recorded as the
recommended *first* real adapter in email-providers.md instead.

## D4 — v1 default provider: `StubEmailProvider` (in-process, no network)

**Decision**: Wire a `StubEmailProvider` as the default (`EMAIL_PROVIDER=stub`). It performs **no
network send**: it returns `accepted: true` with a synthetic `providerMessageId` for well-formed
messages, and can be configured in tests to return `accepted: false` to exercise the failure path. It
does **not** log recipient or body content (FR-014).

**Rationale**: Lets the entire pipeline — validation, sanitization, routing, outcome reporting, the
test page, and e2e — be built and verified now, before any vendor exists, satisfying the spec's
end-to-end test slices deterministically while honoring the deferred-provider instruction. The test
page thus proves the *capability and contract*; real over-the-wire delivery is verified when a real
adapter is added.

**Trade-off (recorded)**: With the stub, no email actually reaches a mailbox, so the parenthetical
"(and the email is received)" in the spec's US1 Independent Test is **deferred** to the future
provider-implementation feature. The observable v1 behavior is a correct `sent`/`failed` outcome.
This is the direct consequence of the user's instruction to defer the provider and is the only
spec deviation; everything else in the spec is implemented.

**Alternatives considered**: (a) A provider that throws "not configured" so every send fails — makes
the test page and e2e assert failure, giving no positive signal that the pipeline works. (b) An
Ethereal/preview transport — pulls in `nodemailer` (a provider impl) prematurely. Both rejected.

## D5 — HTML sanitization (FR-016): `sanitize-html`, server-side, before the provider

**Decision**: When `bodyFormat === "html"`, the Email channel runs the body through `sanitize-html`
(allow a conservative formatting whitelist; strip `<script>`/`<style>`/event handlers/`javascript:`
URLs) **before** constructing `EmailMessage.html`. `text` bodies are passed as `EmailMessage.text`
with no HTML interpretation. The sanitized result is what any future provider receives.

**Rationale**: FR-016 mandates server-side sanitization of HTML bodies. `sanitize-html` is the
standard, well-maintained Node library for exactly this; doing it in the channel (not the provider)
means every future provider inherits the protection. One new dependency, mandated by a present
requirement (Principle II compliant).

**Alternatives considered**: DOMPurify + jsdom — heavier (full DOM) for the same result. A hand-rolled
regex stripper — unsafe, a known footgun. Both rejected.

## D6 — Validation rules + HTTP status mapping

**Decision**: Validate the test request with Zod in `notifications/validation.ts`:
`channel` ∈ known types; for Email — `recipient` is a valid email, `subject` non-empty (trimmed) and
≤ 200 chars, `body` non-empty (trimmed) and ≤ 10 000 chars, `bodyFormat` ∈ {`text`,`html`}. Status
mapping: **invalid input → 400** `VALIDATION_ERROR` (no delivery attempted, FR-006); **known but
disabled channel → 400** `CHANNEL_NOT_SUPPORTED` (FR-009); **delivery attempted →
200** with `SendOutcome` `{ status: "sent" | "failed", reason? }` (a provider rejection/timeout is a
*reported* failure, not an HTTP error — FR-007, FR-008); **no session → 401**.

**Rationale**: Cleanly separates "your request was rejected before we tried" (4xx) from "we tried and
here's the outcome" (200 + outcome), which is exactly the spec's distinction between validation
rejection (FR-006) and reported send failure (FR-007/FR-008). Reuses the existing Zod + `{error,
message}` conventions.

**Alternatives considered**: Returning 5xx for provider failures — conflates client-visible "failed
to deliver" with server bugs and complicates the contract. Rejected.

## D7 — Provider timeout (FR-008, clarified 30 s)

**Decision**: The Email channel wraps `provider.send()` in a 30-second timeout (`AbortController` +
`Promise.race`). On elapse it returns `{ status: "failed", reason: "The email provider did not
respond in time." }`. The stub never triggers it; it exists for real adapters.

**Rationale**: Clarified value (spec FR-008). Bounds the worst case while the SC-001 5-second target
governs the normal path. Implemented in the channel so every provider is bounded uniformly.

**Alternatives considered**: Per-provider timeouts — premature; one app-wide bound is simpler and
matches the clarification.

## D8 — Test-page endpoints + dynamic form data source

**Decision**: Two endpoints under `/api/notifications` (behind `requireAuth`):
`GET /channels` → `ChannelInfo[]` (`{ type, label, available, fields[] }`) so the client renders the
selector and the right inputs per channel; `POST /test` → runs `notify()` and returns the
`SendOutcome`. The client never hard-codes channel/field lists.

**Rationale**: Drives FR-011/FR-012 from the server's single source of truth, so adding a channel
surfaces in the UI with **zero client edits** (SC-003). Two small endpoints keep the contract clear.

**Alternatives considered**: A single endpoint that also returns metadata — muddier contract.
Rejected.

## D9 — No persistence in v1

**Decision**: Store nothing. No DB tables, no audit log; `notify()` returns the outcome and the test
page shows it once.

**Rationale**: Spec Assumptions explicitly exclude history/audit in v1 (KISS). Adding a table now
would be speculative (Principle II).

**Alternatives considered**: A `notification_log` table for debugging — deferred until a real
provider exists and an operational need is concrete.

---

## Deferred (intentional, not blocking)

- **Concrete email provider selection + adapter** — deferred to a future feature per the user's
  instruction; recommendations catalogued in [email-providers.md](./email-providers.md). The
  `EmailProvider` port makes this a localized, caller-invisible change.
- **Real-mailbox delivery verification** — follows provider selection (see D4 trade-off).
- **WhatsApp / push channels** — out of scope (spec); the registry + `NotificationChannel` interface
  accommodate them when needed.
