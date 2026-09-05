# 2Factor SMS OTP Setup (Public Quiz Guest Flow)

Production uses [2Factor](https://2factor.in) for SMS delivery of guest quiz
OTPs; development and tests use a console mock that never sends real SMS.

## Architecture (unchanged by the provider)

The backend remains the source of truth for everything OTP-related:
**Eyeconic generates the OTP** (`crypto.randomInt`, 6 digits), stores only an
**HMAC-SHA256 hash** (`GuestOtp`, challenge-scoped to `(phone, shareToken)`,
10-minute TTL, single-use, resend-replaces), enforces **rate limits**
(per-phone 3/10 min + 60 s cooldown, per-IP 10/10 min, 5 verify-fails/15 min)
and creates the **Guest lead only after successful verification**. 2Factor is
strictly the delivery channel — its verify/session endpoints are not used.

## Environment variables

| Var | Required | Notes |
|---|---|---|
| `TWO_FACTOR_API_KEY` | prod | 2Factor dashboard → API section. Backend-only; never exposed to the frontend, logs, or Git |
| `TWO_FACTOR_OTP_TEMPLATE` | no | DLT-approved OTP template name; appended to the send URL when set |

With `TWO_FACTOR_API_KEY` unset and `NODE_ENV !== 'production'`, sends go to
the console mock (value hidden unless `SMS_MOCK_ECHO=true`). In production an
unconfigured provider hard-fails with **503 `SMS_NOT_CONFIGURED`** — the mock
can never run in production.

## The API used

**Send OTP (Manual Generation)** — we supply the OTP value:

```
GET https://2factor.in/API/V1/{api_key}/SMS/{phone}/{otp}[/{template}]
```

- `phone` is E.164 (`+919876543210`) — the format in 2Factor's examples
- Success: HTTP 200 `{"Status": "Success", "Details": "<session-id>"}`
  (the session id is 2Factor's own concept; we ignore it)
- Failure: HTTP 4xx with plain-text body (`Invalid API Key`,
  `Invalid Phone Number - Length Mismatch(Expected: 10)`) or
  `{"Status": "Error", "Details": ...}` — including on HTTP 200

Every failure mode (HTTP error, `Status: "Error"`, timeout after 15 s,
malformed body) maps to a single safe client contract:
**503 `{"code": "SMS_DELIVERY_FAILED"}`** with a generic user message.
Provider detail is sanitized before logging (API key, OTP value and phone
number are redacted; the request URL — which contains all three — is never
logged), and the client never sees provider text.

## One-time production setup

1. **2Factor account** (2factor.in) with SMS credits (new accounts include
   free credits).
2. **DLT registration** (mandatory for Indian SMS): register on the DLT
   portal as an Enterprise, get your entity/header approved, and link it in
   the 2Factor dashboard. If your account requires a named OTP template for
   delivery, create it and set `TWO_FACTOR_OTP_TEMPLATE` to its name.
3. **Render** (backend service `eyeconic-app-prod` → Environment):
   - set `TWO_FACTOR_API_KEY`
   - optionally set `TWO_FACTOR_OTP_TEMPLATE`
   - remove the retired `MSG91_AUTH_KEY` / `MSG91_TEMPLATE_ID` /
     `MSG91_SENDER_ID` variables if they are still present
   - save (this redeploys the backend)
4. Verify the boot log no longer shows the `TWO_FACTOR_API_KEY is not set`
   warning, then request an OTP from a real public quiz link.

## Verifying configuration without dashboard access

`GET /api/health` reports the live SMS provider state (it degrades the
overall `status` to `degraded` when production runs without a provider):

```bash
curl -s https://eyeconic-app-prod-1r8o.onrender.com/api/health | jq .dependencies.sms
# misconfigured (every OTP send returns 503 SMS_NOT_CONFIGURED):
# {"status":"unconfigured","provider":null,"configured":false}
# correct:
# {"status":"healthy","provider":"2factor","configured":true}
```

## Failure modes (what users see)

| Provider condition | Client response |
|---|---|
| `TWO_FACTOR_API_KEY` unset in production | 503 `SMS_NOT_CONFIGURED` |
| Invalid API key / invalid phone / `Status: "Error"` / HTTP 5xx / timeout / malformed response | 503 `SMS_DELIVERY_FAILED` |

No OTP row is persisted when delivery fails, and no lead is ever created —
guests exist only after a successful OTP verification.
