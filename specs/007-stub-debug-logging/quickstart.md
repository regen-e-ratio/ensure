# Quickstart: Email Stub Debug Logging

How to turn on the email **stub** debug log and use it to confirm that the Email fields you submit on
the notification test page reach the backend correctly. Builds on
[005 — Notifications](../005-notifications-system/quickstart.md); assumes the existing
[Manual setup](../../README.md#manual-setup) (Google OAuth + `server/.env` + encryption keyring) is
done and `EMAIL_PROVIDER` is the default `stub`.

## Turn it on

Add to `server/.env`:

```bash
EMAIL_STUB_DEBUG=1
```

Then run the app:

```bash
npm run dev:server     # Express API on http://localhost:3000  (watch this terminal)
npm run dev:client     # Vite SPA on  http://localhost:5173
```

> ⚠️ **Local debugging only.** When enabled, this writes the **recipient address, subject, and full
> message body** to the **server console**. That is a deliberate, opt-in exception to the
> notification system's "never log recipient or content" rule (005 FR-014) — it is safe because the
> stub performs **no real send**. Leave `EMAIL_STUB_DEBUG` unset anywhere that is not your local
> machine. It is **off by default**.

## Use it

1. Sign in with Google and open **<http://localhost:5173/notifications>**.
2. Select **Email**, fill **recipient / subject / body**, choose **text** or **html**, and **Send**.
3. Look at the **`npm run dev:server` terminal**. You'll see one line like:

   ```text
   [email-stub:debug] received { to: 'you@example.com', subject: 'Hi', bodyFormat: 'text', body: 'Hello there' }
   ```

4. Compare it against what you typed: recipient, subject, body, and format should match exactly. For
   an **html** body, the logged body is the **sanitized** version (what a real provider would
   receive) — so you can also confirm sanitization here.

The send still shows its normal **sent**/**failed** outcome on the page — the log changes nothing
about behavior.

## Turn it off

Remove `EMAIL_STUB_DEBUG` from `server/.env` (or set it to anything other than `1`) and restart the
server. With it off, **no** recipient, subject, or body is written to the logs.

## Notes

- The flag only affects the **stub** provider. When you later add a real email provider (see
  [005's quickstart](../005-notifications-system/quickstart.md#adding-a-real-email-provider-future-localized-change)),
  this debug log does **not** apply to it — by design, real providers never get content logging.
- Bodies are capped at 10,000 characters by validation before reaching the stub, so the full body is
  logged without truncation.

## Test

```bash
npm test            # unit: stub logs all four fields when enabled, stays silent when disabled,
                    #   and returns the same outcome with the flag on or off
npm run typecheck   # tsc --noEmit across workspaces
npm run lint        # ESLint
```

Merge gates (constitution): unit tests + existing notification/e2e suites green, `typecheck` green.
No UI change, so no new accessibility surface.
