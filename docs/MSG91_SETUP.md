# MSG91 SMS OTP Setup (Public Quiz Guest Flow)

The public quiz lead flow verifies guest phone numbers with an SMS OTP.
Production uses [MSG91](https://msg91.com); development and tests use a
built-in console mock that **hard-fails if ever enabled in production**
(`503 SMS_NOT_CONFIGURED`) — there are no hardcoded/test OTPs in production
paths.

Backend implementation: `backend/utils/sms.js` (provider abstraction,
mirroring the email chain in `utils/mailer.js`).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `MSG91_AUTH_KEY` | prod | MSG91 dashboard → Settings → API → Authkey |
| `MSG91_TEMPLATE_ID` | prod | DLT-approved OTP template id (see below) |
| `MSG91_SENDER_ID` | prod | DLT-approved 6-character sender name |
| `OTP_HASH_SECRET` | recommended | HMAC secret for hashing OTPs at rest (falls back to `JWT_SECRET`) |
| `GUEST_JWT_EXPIRES_IN` | optional | Guest session token TTL (default `4h`) |
| `SMS_MOCK_ECHO` | dev only | `true` prints the OTP value in the dev console (default hidden) |
| `WEB_APP_URL` | prod | Web origin for share-link 302s, e.g. `https://eyeconicmentors.vercel.app` — **unset = legacy app-redirect interstitial** |

With all three `MSG91_*` variables unset and `NODE_ENV !== 'production'`,
`sendGuestOtpSms` logs to the console instead of calling the provider. With
them unset in production, every OTP request returns `503 SMS_NOT_CONFIGURED`
and the server logs a critical boot warning.

## Setup checklist (India)

DLT registration is **mandatory** for transactional OTP SMS in India and is
the most common launch blocker — approval commonly takes several days. Start
early.

1. **Create an MSG91 account** (msg91.com) and add SMS balance for the OTP
   route you plan to use.
2. **DLT entity registration**: register your business/entity on a telecom
   DLT portal (Jio, Airtel, or Vodafone Idea) and receive an **Entity ID**.
   Link the entity inside MSG91 (Settings → DLT).
3. **Register a Sender ID** — a 6-character alphabetic name (e.g. `EYECNC`)
   — on the DLT portal, get it approved, and set `MSG91_SENDER_ID` to it.
4. **Create an OTP template** on the DLT portal containing the OTP variable,
   e.g.:
   > `{#var#} is your Eyeconic Mentors verification code. Valid for 10 minutes. Do not share it.`
5. After DLT approval, add the template in MSG91 (OTP → Templates / SMS →
   Templates) and copy the generated **Template ID** into
   `MSG91_TEMPLATE_ID`. The API used by the backend is the
   [MSG91 v5 OTP API](https://docs.msg91.com/reference/send-otp):
   `POST https://control.msg91.com/api/v5/otp` with header `authkey`.
6. **Configure Render** (or your backend host) env vars:
   `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_SENDER_ID`, `WEB_APP_URL`,
   `OTP_HASH_SECRET` (generate a fresh random string), and optionally
   `GUEST_JWT_EXPIRES_IN=4h`.
7. **Verify end-to-end**: open a public quiz link, submit the lead form with
   a real phone, confirm the SMS arrives, and confirm a `Guest` document is
   created in MongoDB only after the code is verified.

## Failure modes

- Missing vars in production → boot warning + `503 SMS_NOT_CONFIGURED` on
  every OTP request (the mock can never serve production traffic).
- MSG91 HTTP error or `{type: 'error'}` payload (bad template, DLT mismatch,
  insufficient balance) → `503 SMS_DELIVERY_FAILED`; the authkey is redacted
  from all logs.
- Template mismatch is the #1 cause of `SMS_DELIVERY_FAILED` right after
  setup — re-check that the template content with the variable matches the
  approved DLT text exactly.
