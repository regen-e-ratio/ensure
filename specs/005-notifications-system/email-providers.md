# Recommended Email Providers (for the deferred provider choice)

> **Status: recommendations only — nothing is chosen or implemented yet.** This is the document the
> feature owner asked for. The notification system is built against a narrow `EmailProvider` port
> (see [research.md](./research.md) D3), so adopting any provider below is a **single-adapter change**
> wired by env, with **zero changes to callers**, the dispatcher, or the Email channel logic. v1 ships
> a no-network `StubEmailProvider`; pick one of these when real delivery is needed.

## What we need from a provider

This app sends **transactional** notifications (system-generated, one recipient, triggered by an
event) — not marketing campaigns. The properties that matter, in priority order:

1. **Deliverability** for transactional mail (good sender reputation, DKIM/SPF/DMARC support).
2. **Simple server-side API or SMTP** that maps cleanly onto `EmailProvider.send({ to, subject,
   html?, text? }) → { accepted, providerMessageId?, reason? }`.
3. **Free / low tier** sufficient for current low volume, with room to grow.
4. **Server-side secret model** (an API key or SMTP credentials held only in `server/.env`, never on
   the client — FR-014).
5. **Region/compliance** options (EU data residency) if/when required.

## Two integration strategies

| Strategy | What the adapter does | Pros | Cons |
|----------|-----------------------|------|------|
| **Vendor HTTP API/SDK** | Calls the provider's REST API (or official SDK) | Best DX, richer status/webhooks, fewer connection pitfalls | Ties the adapter to one vendor's SDK |
| **SMTP (via `nodemailer`)** | Sends over SMTP to any host | **Provider-agnostic** — one adapter works with *every* vendor below + self-hosted; swap by changing SMTP env only | Slightly more config (host/port/user/pass); fewer native status signals |

**Recommended first adapter:** a **`nodemailer` SMTP adapter**. Because every provider below offers
SMTP, a single SMTP adapter gives maximum portability — you can change vendor by editing env, without
even touching the adapter. Move to a vendor's HTTP SDK later only if you need its webhooks/analytics.

## Provider shortlist (transactional)

| Provider | Integration | Free / entry tier (approx.) | Strengths | Watch-outs |
|----------|-------------|------------------------------|-----------|------------|
| **Resend** | HTTP API + SMTP | ~3k emails/mo free | Best-in-class modern DX, React-email friendly, fast setup | Younger product; smaller track record than incumbents |
| **Postmark** | HTTP API + SMTP | ~100/mo free, then paid | Excellent transactional **deliverability & speed**; strict transactional/broadcast separation | No big free tier; paid sooner |
| **Amazon SES** | HTTP API (AWS SDK) + SMTP | Very low per-email cost | **Cheapest at scale**, AWS-native, highly reliable | More setup (domain/DKIM, sandbox→prod), barebones UX |
| **SendGrid** (Twilio) | HTTP API + SMTP | ~100/day free | Mature, high-volume, deliverability tooling & analytics | Heavier API; account/onboarding friction |
| **Mailgun** | HTTP API + SMTP | Trial, then paid | Developer-friendly, strong APIs, **EU region** option | Free tier reduced over time |
| **Brevo** (ex-Sendinblue) | HTTP API + SMTP | ~300/day free | Generous free tier, transactional + marketing, EU-based | UI geared to marketing; transactional is secondary focus |

### Honourable mentions
- **MailerSend** — transactional-focused, decent free tier, good templates.
- **SparkPost** — high-deliverability, enterprise heritage.
- **Scaleway TEM / OVH** — EU-sovereign options if data residency is a hard requirement.
- **Self-hosted SMTP (Postfix)** — maximum control, but you own deliverability/reputation; not
  recommended unless there's a strong reason.

## Recommendation summary

- **Want the easiest path that stays portable:** ship the **`nodemailer` SMTP adapter** and point it
  at whichever provider you sign up for. Swapping providers becomes an env change.
- **Optimise for developer experience / quick start:** **Resend**.
- **Optimise for transactional deliverability:** **Postmark**.
- **Optimise for cost at scale / already on AWS:** **Amazon SES**.
- **Need EU data residency:** **Mailgun (EU)**, **Brevo**, or a sovereign option (Scaleway/OVH).

There is no need to decide now. When you do, the work is: implement one `EmailProvider` adapter,
add its credentials to `server/.env` (server-side only), and set `EMAIL_PROVIDER` to select it — see
[quickstart.md](./quickstart.md) §"Adding a real email provider".
