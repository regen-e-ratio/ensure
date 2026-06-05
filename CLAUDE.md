<!-- SPECKIT START -->
## Active feature: 001-store-notes — Store a Note

Plan: `specs/001-store-notes/plan.md` (read this for full technical context, structure,
and commands). Spec: `specs/001-store-notes/spec.md`. API contract:
`specs/001-store-notes/contracts/openapi.yaml`.

**Stack**: TypeScript end-to-end on Node.js 22 (npm workspaces).
- `server/`: Express 5 + Zod + better-sqlite3 (single-row SQLite `note` table)
- `client/`: React 18 + Vite 5
- `shared/`: API types generated from the OpenAPI contract via `openapi-typescript`
- Tests: Vitest (server + client), Supertest (API), React Testing Library, Playwright (e2e)

**What it does**: one durably-stored shared note, viewed and edited in place. Explicit Save
button; warn on unsaved changes. No auth in this version.

**Constitution gates** (`.specify/memory/constitution.md`): tests-first (NON-NEGOTIABLE),
keep it simple, typed end-to-end, accessible by default (semantic HTML, keyboard, WCAG AA),
small PRs. A change merges only when tests pass, `tsc` passes, and UI meets the a11y baseline.
<!-- SPECKIT END -->
