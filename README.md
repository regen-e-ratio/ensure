# Ensure — Store a Note

A small full-stack web app that keeps a **single, durably-stored note** you can read and edit in
place. It's the foundation for a future "deadman switch" application (where, if the user stops
acknowledging they're alive, notes are shared with chosen contacts). This first slice deliberately
does the basics only: one shared note, persisted in a backend database. **No accounts or
authentication yet.**

See the full spec and plan under [`specs/001-store-notes/`](specs/001-store-notes/).

## Tech stack

TypeScript end-to-end, npm workspaces:

- **`server/`** — Express 5 + Zod validation + better-sqlite3 (single-row `note` table)
- **`client/`** — React 18 + Vite 5
- **`shared/`** — API types generated from the OpenAPI contract via `openapi-typescript`
- **`e2e/`** — Playwright acceptance tests
- **`contracts/openapi.yaml`** — the API contract (source of truth)

## Prerequisites

- Node.js 22 LTS (ships with npm). Check: `node -v`.

## Setup

```bash
npm install
npm run gen:api   # generate shared/src/api.ts from contracts/openapi.yaml
```

## Run (development)

```bash
npm run dev:server   # Express on http://localhost:3000 (SQLite at ./data/note.db)
npm run dev:client   # Vite on http://localhost:5173 (proxies /api -> :3000)
```

Open http://localhost:5173. With no note saved you see an empty state; write text and press
**Save**. Reload — it persists. Restart the server — it's still there.

## API

| Method | Path        | Body       | Success                      | Errors |
|--------|-------------|------------|------------------------------|--------|
| GET    | `/api/note` | —          | `200 { note: Note \| null }` | —      |
| PUT    | `/api/note` | `{ text }` | `200 { note: Note }`         | `400 { error, message }` for empty/whitespace or > 10000 chars |

`Note = { text, createdAt, updatedAt }`.

## Tests & quality gates

```bash
npm test            # server (contract/integration/unit) + client (component) — Vitest
npm run typecheck   # tsc --noEmit across all workspaces
npm run lint        # ESLint
npm run test:e2e    # Playwright acceptance tests (see note below)
```

A change is ready to merge only when tests + e2e pass, `typecheck` passes, and UI changes meet the
accessibility baseline (semantic HTML, labelled controls, keyboard navigation, WCAG AA contrast) —
per the project [constitution](.specify/memory/constitution.md).

### Running e2e locally

The e2e suite starts the server and client automatically. On environments where Playwright's
bundled Chromium isn't available, drive the system Chrome instead:

```bash
PW_CHANNEL=chrome npm run test:e2e
```

In CI, install the browser normally (`npx playwright install --with-deps chromium`) and run without
`PW_CHANNEL`.

## Scope (this version)

In scope: one shared note; create/view/update; durable persistence; explicit Save with an
unsaved-changes warning. Out of scope: accounts/auth, multiple notes, version history, deletion as a
user feature, contacts, and the deadman-switch mechanism itself.
