# Email (OTP) Delivery — Operations Guide

Covers every email the backend sends: signup OTP, password-reset OTP, and the
public-quiz guest verification code. All three share `backend/utils/mailer.js`.

## Provider chain

1. **SMTP (primary)** — nodemailer, cached **pooled** transporter
   (`pool: true`, `SMTP_POOL_MAX_CONNECTIONS=5`, `SMTP_POOL_MAX_MESSAGES=200`
   by default). Connections are authenticated once and reused; a fresh
   TCP+TLS+AUTH handshake per message is what trips provider connection-rate
   limits when a whole class requests codes at once.
2. **Resend API (fallback)** — used only when SMTP stays failed after its
   retry budget AND `RESEND_API_KEY` is configured.

## Retry policy (why OTPs no longer intermittently vanish)

SMTP providers routinely emit *transient* failures — `421 Try again later`,
`450/451` greylisting or throttling, connection resets, DNS blips. A single
attempt turned each of those into a student-visible "code not sent". Now:

- Transient failures are **retried up to 3 attempts** per provider
  (500 ms → 1.5 s backoff + jitter).
- Permanent failures fail fast without burning retries:
  - SMTP `5xx` (mailbox does not exist, policy blocks)
  - SMTP auth failures (`535` / nodemailer `EAUTH`)
  - Resend `4xx` other than `429`
- A **20-second deadline** bounds the whole chain (no new attempt starts
  past it), so the response always reaches the client before its timeout —
  the web client gives `send-otp` a 60 s ceiling, everything else uses 30 s.
- `EMAIL_RECIPIENT_REJECTED` (see below) skips retries AND the fallback —
  no provider can deliver to a mailbox the relay says does not exist.

### Known trade-off

If SMTP times out *after* a message was actually accepted (rare — the 250
response was lost), the fallback may send the same code twice. Both emails
contain the identical OTP, so this is cosmetic; the alternative (never
falling back on timeouts) fails far more deliveries than it saves.

## `EMAIL_RECIPIENT_REJECTED` — the "phantom success" bug (fixed 2026-10-01)

Previously, when the relay rejected the recipient at the SMTP envelope stage
(`RCPT TO` → 550 — typically a typo'd domain such as `@gnmail.com` that passes
the syntactic email check), nodemailer **resolved successfully** with the
address in `info.rejected`. The API answered `200 "code sent"`, no email could
ever arrive, and every resend "succeeded" too — the student waited forever.

Now this outcome is detected and surfaced to the user as
`422 { code: "EMAIL_RECIPIENT_REJECTED" }` with the message *"We could not
deliver the code to this email address. Please double-check the spelling and
try again."* Because it is a 4xx, the per-email send rate limiter does not
count it — the student can correct the typo and retry immediately.

## Investigating "the code never arrived"

Every real provider attempt is recorded in the `emaildeliverylogs` collection
(30-day TTL, best-effort — delivery is never blocked by logging):

| Field | Meaning |
|---|---|
| `toEmail` | recipient address (normalized lowercase) |
| `purpose` | `signup` \| `password-reset` \| `guest-quiz` |
| `provider` | `smtp`, `resend`, or `smtp+resend-fallback` |
| `status` | `sent` (provider ACCEPTED — 250/2xx) or `failed` |
| `attempts` | attempts actually made for that provider |
| `messageId` | provider message id, when returned |
| `errorCode` | classification, e.g. `smtp-421`, `econnreset`, `recipient-rejected`, `resend-429`, `smtp-auth` |
| `errorDetail` | sanitized provider text (secrets redacted, ≤300 chars) |
| `requestId` | correlates with HTTP request logs |
| `durationMs` | wall-clock time spent in the delivery chain |

Quick triage (Mongo shell / Atlas — production data lives in the `test` db):

```js
// One student's recent history
db.emaildeliverylogs.find({ toEmail: 'student@example.com' }).sort({ createdAt: -1 })

// All failures in the last hour (outage triage)
db.emaildeliverylogs.find({ status: 'failed', createdAt: { $gt: new Date(Date.now() - 3600e3) } }).sort({ createdAt: -1 })
```

Reading the results:

- **No rows at all** → the request never reached a provider: not in the log
  collection *and* no `[EMAIL]` server log → check validation errors, rate
  limiting (`429 RATE_LIMITED` in HTTP logs), or email env vars missing.
- **`status: 'sent'` but the student never saw it** → the provider accepted
  the message; look at spam/junk on the recipient side, and at DNS alignment
  below (misaligned From → junk folder).
- **`errorCode: 'recipient-rejected'`** → the address does not exist; the UI
  already told the student to fix the spelling.
- **`errorCode: 'smtp-auth'`** → SMTP credentials are wrong/rotated; fix
  `SMTP_USER`/`SMTP_PASS` in the Render dashboard.
- **Clusters of `smtp-421` / `econnreset`** → provider throttling or a
  provider incident; retries now absorb brief ones automatically.

## Deliverability (keeping codes out of spam)

Application-side rules are already in place (aligned From, pooled
connections, no attachments). The DNS side lives in the domain provider:

- **SPF** — include your SMTP provider's sending servers on the domain in
  `SMTP_FROM_EMAIL`.
- **DKIM** — add the keys your provider generates for that domain.
- **DMARC** — at minimum `v=DMARC1; p=none; rua=mailto:...` so you receive
  alignment reports.

If `SMTP_FROM_EMAIL` is unset, the authenticated `SMTP_USER` address is used
as From — keep it on a domain you control so the above stay aligned.

## Client behavior reference

| Client | Call | Timeout | Notes |
|---|---|---|---|
| Web (public quiz) | `POST /api/public/quiz/:token/lead/send-otp` | 60 s | covers the full server retry chain |
| Web (public quiz) | all other guest calls | 30 s | |
| Mobile app | `/auth/send-otp`, `/auth/forgot-password-send-otp` | 30 s | axios interceptor retries these automatically |

Response codes the clients surface: `503 EMAIL_DELIVERY_FAILED` (retry in a
moment), `422 EMAIL_RECIPIENT_REJECTED` (fix the address),
`503 EMAIL_NOT_CONFIGURED` (server env problem — check Render env vars),
`429 RATE_LIMITED` (per-email 3/10 min + 60 s cooldown; per-IP 10/10 min).
