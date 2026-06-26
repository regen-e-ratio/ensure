## README maintenance

`README.md` is the single source of operational truth. Keep it lean and current.

**Allowed scope — nothing else.** The README contains only a minimal header (name + one-line
purpose) plus exactly four sections:

1. **Architecture** — components & responsibilities, how they interact, the data store, the
   auth/session model, and every external service. In detail.
2. **Run** — the exact, ordered commands to start the app locally (incl. codegen) and the resulting
   URLs/ports.
3. **Manual setup** — every prerequisite not produced by `npm install`: each env var/secret (by
   name + purpose + where it goes) and each external resource to provision (e.g. the Google OAuth
   client). **Never write real secret values** — only how to obtain/supply them.
4. **Tests** — the commands per test category, env-specific variants, and the merge quality gates.

**Update only if relevant.** When a change affects architecture, how to run the app, manual setup
(a new external service, secret, or env var), or how to run/test it, update the matching README
section **in the same commit**. When a change touches none of those (internal refactor, comment,
spec/docs edit), **leave the README unchanged** — no churn.

**No bloat.** Do not add roadmaps, history, vision, scope in/out lists, or API tables (the API
contract lives in `contracts/openapi.yaml`). Such content belongs in `specs/**`, not the README.

A `.githooks/pre-commit` hook (`scripts/readme-relevance.mjs`, activated by the `prepare` script)
reminds you when a README-relevant change isn't accompanied by a README update; the author remains
the final arbiter and can proceed with `git commit --no-verify`.


# Implementation

If you create a plan/documentation/roadmap/worflow when implementing a feature create a file in the specs folder
