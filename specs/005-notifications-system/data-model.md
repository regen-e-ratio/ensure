# Phase 1 Data Model: Generic Notification System (Email)

**No database tables are added.** v1 persists nothing (no audit log/history — spec Assumptions). The
"data" here is the set of **in-memory types** that cross the dispatcher → channel → provider
boundaries and the **validation rules** enforced before any send. Contract-facing shapes are authored
in `contracts/openapi.yaml` and consumed via the generated `shared/src/api.ts`; provider-facing shapes
are server-internal (`server/src/notifications/`).

## Entities / types

### NotificationChannelType (enum)
`"email" | "whatsapp" | "push"`. Only `email` is sendable in v1; the others exist so the system and UI
can present the extension point (US3, FR-011). New channels extend this union.

### NotificationRequest (generic, dispatcher input)
The uniform shape every caller uses (FR-002).
| Field | Type | Notes |
|-------|------|-------|
| `channel` | `NotificationChannelType` | Selects the handler via the registry. |
| `recipient` | `string` | Channel-interpreted (for Email: an address). |
| `content` | `EmailContent` (channel-specific) | For Email: `{ subject, body, bodyFormat }`. |

> The generic dispatcher does not interpret `recipient`/`content`; it routes by `channel` and the
> channel validates and interprets them. This keeps callers channel-agnostic (FR-001, SC-002).

### EmailContent (Email channel-specific content)
| Field | Type | Validation |
|-------|------|------------|
| `subject` | `string` | Required; trimmed length 1…200 (FR-005, FR-006; clarified ≤ 200). |
| `body` | `string` | Required; trimmed length 1…10 000 (FR-005, FR-006; clarified ≤ 10 000). |
| `bodyFormat` | `"text" \| "html"` | Required; chooses plain text vs HTML (clarified, FR-005). |

### ChannelField (UI descriptor)
Describes one input a channel needs, so the test page can render the form dynamically (FR-012).
| Field | Type | Notes |
|-------|------|-------|
| `name` | `string` | e.g. `recipient`, `subject`, `body`, `bodyFormat`. |
| `label` | `string` | Human label for the control. |
| `type` | `"email" \| "text" \| "textarea" \| "select"` | Control kind. |
| `required` | `boolean` | Drives client + server validation messaging. |
| `options` | `string[]?` | For `select` (e.g. `["text","html"]`). |

### ChannelInfo (response of `GET /notifications/channels`)
| Field | Type | Notes |
|-------|------|-------|
| `type` | `NotificationChannelType` | The channel id. |
| `label` | `string` | Display name (e.g. "Email"). |
| `available` | `boolean` | `true` only for Email in v1; others `false` (cannot send). |
| `fields` | `ChannelField[]` | Inputs to render when this channel is selected. |

### NotificationTestRequest (body of `POST /notifications/test`)
The flattened, contract-facing request the test page submits.
| Field | Type | Notes |
|-------|------|-------|
| `channel` | `NotificationChannelType` | Required. |
| `recipient` | `string` | Required for Email; validated as an email. |
| `subject` | `string` | Email field (see EmailContent). |
| `body` | `string` | Email field (see EmailContent). |
| `bodyFormat` | `"text" \| "html"` | Email field. |

### SendOutcome (dispatcher + endpoint result)
The explicit outcome of every attempt (FR-007). No request fails silently.
| Field | Type | Notes |
|-------|------|-------|
| `status` | `"sent" \| "failed"` | `sent` = accepted by the provider (spec Assumptions). |
| `channel` | `NotificationChannelType` | Echo of the attempted channel. |
| `reason` | `string?` | Present when `failed`; human-readable (provider error, timeout, unsupported channel). |
| `providerMessageId` | `string?` | Present when `sent`, if the provider returns one. |

### EmailProvider (server-internal port) + EmailMessage / ProviderResult
The swap boundary (research D3). **Not** part of the HTTP contract.
```text
interface EmailProvider { send(message: EmailMessage): Promise<ProviderResult> }
EmailMessage  = { to: string; subject: string; html?: string; text?: string }   // exactly one of html/text set
ProviderResult = { accepted: boolean; providerMessageId?: string; reason?: string }
```

## Validation rules (enforced before any send — FR-006)

1. `channel` must be a known `NotificationChannelType`; otherwise 400 `VALIDATION_ERROR`.
2. `channel` must be **available** (Email only in v1); a known-but-disabled channel → 400
   `CHANNEL_NOT_SUPPORTED`, no delivery attempted (FR-009).
3. Email `recipient` must be a syntactically valid email address (FR-005); else 400.
4. Email `subject`: trimmed, non-empty, ≤ 200 chars; else 400 (FR-005, FR-006).
5. Email `body`: trimmed, non-empty, ≤ 10 000 chars; else 400 (FR-005, FR-006).
6. Email `bodyFormat` ∈ {`text`,`html`}; else 400.
7. When `bodyFormat === "html"`, the body is **sanitized server-side** (strip scripts/unsafe markup)
   before becoming `EmailMessage.html` (FR-016). `text` bodies become `EmailMessage.text`.

## State & lifecycle

Stateless and synchronous: validate → (if valid & available) hand to the channel → channel sanitizes
+ calls the provider under a 30 s timeout → return a `SendOutcome`. Nothing is stored; there are no
transitions to persist. Concurrent requests are independent (no shared mutable state).

## Relationship to existing data

None. The `note`, `user`, and `session` tables are untouched; this feature adds no columns, tables, or
migrations. It reuses only the existing auth (`requireAuth`, `req.user`) for access control (FR-013).
