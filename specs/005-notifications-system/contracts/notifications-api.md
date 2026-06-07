# Contract: Notifications API (`/api/notifications`)

Two endpoints back the generic notification capability and its test page. Both are mounted **behind
`requireAuth`** (FR-013): no valid access token → `401 UNAUTHORIZED`, consistent with `/api/note`.

These shapes are the **source of truth to add to `contracts/openapi.yaml`**; `shared/src/api.ts` is
then regenerated (`npm run gen:api`) so client and server share one typed contract. No hand edits to
the generated file.

---

## `GET /api/notifications/channels`

Lists channels and the fields each needs, so the test page renders its selector and per-channel form
from server truth (FR-011, FR-012, SC-003).

**Auth**: session cookie required.

**200 OK**
```json
{
  "channels": [
    {
      "type": "email",
      "label": "Email",
      "available": true,
      "fields": [
        { "name": "recipient",  "label": "Recipient address", "type": "email",    "required": true },
        { "name": "subject",    "label": "Subject",           "type": "text",     "required": true },
        { "name": "body",       "label": "Body",              "type": "textarea", "required": true },
        { "name": "bodyFormat", "label": "Body format",       "type": "select",   "required": true,
          "options": ["text", "html"] }
      ]
    },
    { "type": "whatsapp", "label": "WhatsApp", "available": false, "fields": [] },
    { "type": "push",     "label": "Push",     "available": false, "fields": [] }
  ]
}
```
`available: false` channels are shown but **cannot be selected to send** (US3, FR-011).

**401** — `{ "error": "UNAUTHORIZED", "message": "Sign in to continue." }`

---

## `POST /api/notifications/test`

Invokes the **same** generic `notify()` capability any caller uses (FR-001, US2) and returns the
explicit outcome (FR-007).

**Auth**: session cookie required.

**Request body** (`NotificationTestRequest`)
```json
{
  "channel": "email",
  "recipient": "person@example.com",
  "subject": "Test notification",
  "body": "Hello from the notification system.",
  "bodyFormat": "text"
}
```

**200 OK — delivery attempted, outcome reported** (`SendOutcome`)
```json
{ "outcome": { "status": "sent", "channel": "email", "providerMessageId": "stub-7f3a..." } }
```
or, when the provider rejected/timed out (FR-007, FR-008):
```json
{ "outcome": { "status": "failed", "channel": "email",
               "reason": "The email provider did not respond in time." } }
```
> A provider-side failure is a **reported 200 outcome**, not an HTTP error — the request was valid and
> processed; only delivery failed.

**400 VALIDATION_ERROR** — invalid input; **no delivery attempted** (FR-006). Examples:
```json
{ "error": "VALIDATION_ERROR", "message": "Recipient must be a valid email address." }
{ "error": "VALIDATION_ERROR", "message": "Subject must be at most 200 characters." }
{ "error": "VALIDATION_ERROR", "message": "Body is required." }
```

**400 CHANNEL_NOT_SUPPORTED** — a known but not-yet-enabled channel (FR-009); no delivery attempted:
```json
{ "error": "CHANNEL_NOT_SUPPORTED", "message": "The 'whatsapp' channel is not available yet." }
```

**401** — `{ "error": "UNAUTHORIZED", "message": "Sign in to continue." }`

---

## Status-code summary

| Situation | Status | Body |
|-----------|--------|------|
| Valid request, provider accepted | 200 | `{ outcome: { status: "sent", … } }` |
| Valid request, provider rejected/timed out | 200 | `{ outcome: { status: "failed", reason } }` |
| Invalid field (email/subject/body/format) | 400 | `{ error: "VALIDATION_ERROR", message }` |
| Known channel, not enabled | 400 | `{ error: "CHANNEL_NOT_SUPPORTED", message }` |
| No/invalid session | 401 | `{ error: "UNAUTHORIZED", message }` |

## OpenAPI schemas to add

`NotificationChannelType` (enum `email|whatsapp|push`), `ChannelField`, `ChannelInfo`,
`ChannelsResponse` (`{ channels: ChannelInfo[] }`), `NotificationTestRequest`, `SendOutcome`,
`SendOutcomeResponse` (`{ outcome: SendOutcome }`) — reusing the existing `Error` schema for 4xx/401.
All objects `additionalProperties: false`, mirroring the existing contract style.
