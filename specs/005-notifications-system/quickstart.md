# Quickstart: Generic Notification System (Email)

How to run the app with the notification test page, how the v1 stub behaves, how to add a **real**
email provider later, and how to test. Assumes the existing [Manual setup](../../README.md#manual-setup)
(Google OAuth client + `server/.env` + encryption keyring) is done.

## Run

```bash
npm install
npm run gen:api        # regenerate shared/src/api.ts from contracts/openapi.yaml (now incl. notifications)
npm run dev:server     # Express API on http://localhost:3000
npm run dev:client     # Vite SPA on  http://localhost:5173
```

Sign in with Google, then open **<http://localhost:5173/notifications>** (also linked from the note
page). Select **Email**, fill recipient / subject / body, choose **text** or **html**, and **Send**.
You'll see an explicit **sent** or **failed** outcome.

## What v1 actually does (stub provider)

No email vendor is configured yet (by design — see
[email-providers.md](./email-providers.md)). The default `EMAIL_PROVIDER=stub` provider performs **no
network send**: it returns a `sent` outcome with a synthetic message id for well-formed requests, so
you can exercise the full pipeline (validation, HTML sanitization, routing, outcome reporting) without
a vendor. **No real email is delivered** until you add a real provider (next section).

Things you can verify against the stub today:
- Malformed recipient / empty subject or body / subject > 200 / body > 10 000 → rejected with a
  validation message, **no send attempted**.
- A not-yet-enabled channel (WhatsApp/Push shown but disabled) → "channel not supported".
- HTML bodies are sanitized server-side before reaching the provider.

## Env vars (server/.env)

| Variable | Purpose | Default |
|----------|---------|---------|
| `EMAIL_PROVIDER` | Selects the email adapter to use. `stub` = in-process, no network send. | `stub` |

> Real-provider credentials (API key or SMTP host/user/pass) are added here **only when you implement
> a real adapter** — see below. They stay server-side and are never exposed to the client (FR-014).

## Adding a real email provider (future, localized change)

The system is built so this touches **only** the provider boundary — no caller, dispatcher, channel,
or UI change (FR-004, SC-002/SC-003). Steps:

1. **Pick a provider** from [email-providers.md](./email-providers.md). A `nodemailer` SMTP adapter is
   the recommended first choice — one adapter works with any SMTP provider.
2. **Implement the port**: create `server/src/notifications/channels/email/providers/<name>-provider.ts`
   implementing `EmailProvider` (`send(message) → { accepted, providerMessageId?, reason? }`). Map
   provider errors/timeouts to `accepted: false` + a human-readable `reason`.
3. **Add credentials** to `server/.env` (e.g. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, or
   `RESEND_API_KEY`, …) and parse them in `server/src/config/env.ts` (Zod, server-side only).
4. **Select it**: set `EMAIL_PROVIDER=<name>` so the registry wires your adapter instead of the stub.
5. **Update the README** Architecture/Manual-setup/Tests sections in the same commit (new external
   service + new secrets) per the README-maintenance rule.

No change to `notifier.ts`, the Email channel, the routes, or the client is required.

## Test

```bash
npm test            # unit + integration: dispatcher, registry, email channel (validation +
                    #   sanitization + timeout), stub provider, GET /channels, POST /test
npm run typecheck   # tsc --noEmit across workspaces
npm run lint        # ESLint
npm run test:e2e    # Playwright: sign in → send a stub email → assert the success outcome
```

Merge gates (constitution): tests + e2e green, `typecheck` green, and the test page meets the
accessibility baseline (semantic form, labelled controls, keyboard operation, WCAG AA contrast, live
outcome region).
