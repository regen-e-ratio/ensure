# Phase 1 Contract: Contacts HTTP API

**Feature**: 006-user-settings-contacts | **Date**: 2026-06-07

These operations are added to the **root** `contracts/openapi.yaml` (OpenAPI 3.1.0) in the existing
Note style, then regenerated into `shared/src/api.ts` via `npm run gen:api`. All operations require a
valid session cookie (`requireAuth`) and are **scoped to the caller** — no path/query/body field ever
identifies another user. Errors use the existing `Error { error, message }` schema.

---

## Operations

### `GET /api/contact` — list the caller's contacts (`operationId: getContacts`)

| Response | Body | When |
|----------|------|------|
| `200` | `ContactListResponse` (`{ contacts: Contact[] }`, may be empty) | Success |
| `401` | `Error` (`UNAUTHORIZED`) | No valid access token |

Contacts are returned ordered by `createdAt` ascending.

### `POST /api/contact` — add a contact (`operationId: addContact`)

Request body: `ContactInput` `{ type: "email", value: string }`.

| Response | Body | When |
|----------|------|------|
| `201` | `Contact` | Added; returns the stored contact (with server-assigned `id`, original-case `value`) |
| `400` | `Error` (`VALIDATION_ERROR`) | Missing fields, `type` ≠ `email`, malformed email, or `value` > 320 chars |
| `409` | `Error` (`DUPLICATE_CONTACT`) | The normalized value already exists for this user/type (FR-008) |
| `409` | `Error` (`CONTACT_LIMIT_REACHED`) | The user already has 50 contacts (FR-015) |
| `401` | `Error` (`UNAUTHORIZED`) | No valid access token |

### `DELETE /api/contact/{id}` — remove a contact (`operationId: removeContact`)

Path param `id` (string).

| Response | Body | When |
|----------|------|------|
| `204` | _(empty)_ | Contact removed, **or** no matching owned contact existed (idempotent, US3 #3) |
| `401` | `Error` (`UNAUTHORIZED`) | No valid access token |

A `DELETE` for an `id` owned by **another** user behaves exactly like a non-existent id (`204`,
no-op) — one user can never affect another's contacts and cannot probe for their ids (FR-003).

---

## Schemas (added to `components.schemas`)

```yaml
Contact:
  type: object
  additionalProperties: false
  required: [id, type, value, createdAt]
  properties:
    id:
      type: string
      description: Server-assigned unique id for this contact.
    type:
      type: string
      enum: [email]
      description: Contact type. Only "email" is supported in this release; the field exists so
        future types (phone, username) can be added without changing existing contacts.
    value:
      type: string
      maxLength: 320
      description: The email address as entered (trimmed, original case preserved for display).
    createdAt:
      type: string
      format: date-time

ContactInput:
  type: object
  additionalProperties: false
  required: [type, value]
  properties:
    type:
      type: string
      enum: [email]
    value:
      type: string
      minLength: 1
      maxLength: 320

ContactListResponse:
  type: object
  additionalProperties: false
  required: [contacts]
  properties:
    contacts:
      type: array
      items:
        $ref: "#/components/schemas/Contact"
```

> Note: `value_norm` is an internal storage/dedup column (see data-model.md) and is **never** part of
> any request or response schema.

---

## Contract test checklist (server, Supertest)

- `GET` empty → `200 { contacts: [] }`; populated → array of `Contact` with exactly
  `[id, type, value, createdAt]` keys (no `value_norm`).
- `POST` valid email → `201` with original-case `value` echoed and a non-empty `id`.
- `POST` `type: "phone"` (or any non-email) → `400 VALIDATION_ERROR` (FR-006).
- `POST` malformed email / empty / > 320 chars → `400 VALIDATION_ERROR` (FR-007, FR-014).
- `POST` same email differing only in case/whitespace → `409 DUPLICATE_CONTACT`; original row's
  `value` unchanged (FR-008, FR-013).
- `POST` when user already has 50 → `409 CONTACT_LIMIT_REACHED` (FR-015).
- `DELETE` existing → `204`, then `GET` no longer lists it; `DELETE` again → `204` (idempotent).
- **Isolation**: user A (`sub: a`) and user B (`sub: b`) — B's `GET` never shows A's contacts; B
  `DELETE`-ing A's id is a `204` no-op and A still has the contact (FR-003).
- All four operations without a session cookie → `401 UNAUTHORIZED` (FR-012).
