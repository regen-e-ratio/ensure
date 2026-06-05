# Quickstart: Store a Note

**Feature**: `001-store-notes` | **Date**: 2026-06-05

This is the developer quickstart for the single-note web app. It reflects the plan in
[plan.md](./plan.md); the API contract is [contracts/openapi.yaml](./contracts/openapi.yaml).

## Prerequisites

- Node.js 22 LTS (ships with npm). Check: `node -v`.

## Repository layout (npm workspaces)

```text
package.json          # workspaces: ["shared", "server", "client"]
contracts/openapi.yaml
shared/   # contract-derived types + shared constants
server/   # Express 5 + Zod + better-sqlite3
client/   # React 18 + Vite 5
e2e/      # Playwright acceptance tests
```

## First-time setup

```bash
npm install                      # installs all workspaces
npm run gen:api                  # generate shared/src/api.ts from contracts/openapi.yaml
```

`gen:api` runs `openapi-typescript contracts/openapi.yaml -o shared/src/api.ts`. Re-run it whenever
the contract changes — `shared/src/api.ts` is generated, never hand-edited.

## Run in development

```bash
# Terminal 1 — backend (Express on :3000, SQLite file ./data/note.db)
npm run dev --workspace server

# Terminal 2 — frontend (Vite on :5173, proxies /api -> :3000)
npm run dev --workspace client
```

Open http://localhost:5173. With no note saved you see the empty state; write text and press
**Save**. Reload the page — the text persists. Stop and restart the server — the text is still there
(durable in SQLite).

## API at a glance

| Method | Path        | Body            | Success | Notes |
|--------|-------------|-----------------|---------|-------|
| GET    | `/api/note` | —               | `200 { note: Note \| null }` | `null` → empty state |
| PUT    | `/api/note` | `{ text }`      | `200 { note: Note }` | upsert; replaces text in place |
|        |             | invalid `text`  | `400 { error, message }` | empty/whitespace or > 10000 chars |

Manual check:

```bash
curl -s localhost:3000/api/note
curl -s -X PUT localhost:3000/api/note -H 'content-type: application/json' \
  -d '{"text":"Remember to water the plants."}'
```

## Testing (TDD — write tests first; CI gate)

```bash
npm test                         # all workspaces (Vitest)
npm test --workspace server      # contract + integration + unit
npm test --workspace client      # React Testing Library component tests
npm run test:e2e                 # Playwright acceptance (real browser)
npm run typecheck                # tsc --noEmit across workspaces
```

Acceptance scenarios → tests mapping:

- US1 save + persist across reload/restart → server integration + Playwright `note.spec.ts`.
- Empty/whitespace rejected (FR-004) → server unit/integration + client component test.
- Over-length rejected (FR-008) → server unit/integration.
- US2 view current note + edit replaces it (FR-005/006/007) → component + Playwright.
- Unsaved-changes warning on exit (FR-002a) → Playwright (browser `beforeunload`).

## Definition of done (constitution merge gates)

A change is ready to merge only when: `npm test` and `npm run test:e2e` pass, `npm run typecheck`
passes, and UI changes meet the accessibility baseline (semantic form, labelled textarea, keyboard
navigable, WCAG AA contrast, `aria-live` status/errors).
