# Public Quiz Web — Render Static Site Deployment

The public quiz web frontend (plus the admin dashboard, which ships in the same
Vite bundle) is hosted on a **Render Static Site**, not Vercel. Vercel keeps
serving the admin dashboard independently and is unaffected.

```
Admin shares link (generate-share-link)
        ↓  WEB_APP_URL  ← eyeconic-public-web (Render Static Site)
https://<public-web-host>/public-quiz/<shareToken>
        ↓ fetch
Render backend (eyeconic-app-prod) — public quiz API, OTP, grading, persistence
```

Everything below is **deployment configuration only** — the public quiz
workflow (OTP flow, grading, expiry, results, analytics) is unchanged.

---

## 1. One-time setup (Render dashboard)

The repo-root `render.yaml` blueprint declares **only** the
`eyeconic-public-web` static site. The production backend `eyeconic-app-prod`
is deliberately **not** part of the blueprint — Render manages only what the
file declares, so applying it cannot change the backend's plan, health check,
or environment variables. (The backend URL appears in the file solely as the
`VITE_API_URL` value the frontend calls.)

1. **Push the blueprint change to GitHub** (repo `main`).
2. Render dashboard → **New Blueprint** (repo `main`, root `render.yaml`) →
   review the pending changes. It must list ONLY:
   - *Create static site `eyeconic-public-web`*
   If the screen mentions associating or updating `eyeconic-app-prod` in any
   way, STOP — that would mean a stale blueprint version; re-pull `main`.
   - If you prefer not to use the blueprint at all, create the site manually
     with the exact values from `render.yaml`:
     - **Type:** Static Site, **Branch:** main
     - **Build Command:** `cd client && npm ci && npm run build`
     - **Publish Directory:** `client/dist`
     - **Rewrite rule (Routes):** Source `/*` → Destination `/index.html`,
       Action **Rewrite** (needed so direct navigation/refresh on
       `/public-quiz/<token>`, `/take`, `/result/<attemptId>` never 404s)
     - **Env vars:** `NODE_VERSION=22`,
       `VITE_API_URL=https://eyeconic-app-prod-1r8o.onrender.com/api`,
       `VITE_SOCKET_URL=https://eyeconic-app-prod-1r8o.onrender.com`
3. Wait for the build to finish, then **copy the static site's URL** from its
   service page (Render appends a uniqueness suffix to the hostname if the
   name is taken — copy whatever it actually shows, e.g.
   `https://eyeconic-public-web-ab1c.onrender.com`).
4. **Backend service (`eyeconic-app-prod`) → Environment → `WEB_APP_URL`** —
   set it to that URL (a bare host is also accepted and served over https).
   Saving triggers a backend redeploy, which also picks up the latest code.
   The backend is not blueprint-managed, so this (like every backend env
   var) is set directly in the dashboard.

Share links generated after this point (and the legacy `/api/public/share/:token`
302) point at the Render static site. The backend boot log prints the resolved
value: `Public quiz web app URL`.

> Optional: attach a custom domain to the static site in the dashboard, then
> update `WEB_APP_URL` to it — CORS follows automatically (see §3).

## 2. Environment variables

**Frontend — Render static site `eyeconic-public-web`** (all public, no secrets):

| Var | Value | Notes |
|---|---|---|
| `NODE_VERSION` | `22` | Vite 7 requires Node ≥ 22.12 |
| `VITE_API_URL` | `https://eyeconic-app-prod-1r8o.onrender.com/api` | Baked in at build time |
| `VITE_SOCKET_URL` | `https://eyeconic-app-prod-1r8o.onrender.com` | Dashboard notifications |

**Backend — Render web service `eyeconic-app-prod`** (change marked ▸):

| Var | Value | Notes |
|---|---|---|
| ▸ `WEB_APP_URL` | `https://<static-site-URL>` | Where public links point; scheme-less host accepted |
| `ALLOWED_ORIGINS` | `https://eyeconicmentors.vercel.app` | Admin origin (unchanged); the `WEB_APP_URL` origin is allowed automatically |
| `TWO_FACTOR_API_KEY` | (secret) | Real SMS OTP via 2Factor — see `docs/2FACTOR_SETUP.md` |
| `TWO_FACTOR_OTP_TEMPLATE` | (optional) | DLT-approved OTP template name, if your 2Factor account requires one |
| `OTP_HASH_SECRET` | (secret) | HMAC key for guest OTP hashes |
| `GUEST_JWT_EXPIRES_IN` | `4h` | Guest session lifetime |

## 3. CORS

`backend/config/cors.js` appends the origin parsed from `WEB_APP_URL` to the
allowed list (both the HTTP API and the socket server). The Vercel admin
origin keeps working via `ALLOWED_ORIGINS`; no wildcard is used. Changing the
public web host = changing `WEB_APP_URL` only.

## 4. Post-deploy verification

1. **Link opens the quiz** — `https://<static-site>/public-quiz/<shareToken>`
   shows the quiz landing page. No login wall, no app redirect, no 404.
2. **SPA refresh** — direct-load and refresh on `/public-quiz/<token>`,
   `/public-quiz/<token>/take`, `/public-quiz/<token>/result/<attemptId>`
   (the rewrite rule covers these).
3. **OTP flow** — name + phone + consent → OTP request/verify; wrong and
   expired codes rejected; rate limits (429) enforced. Real SMS requires
   `TWO_FACTOR_API_KEY` (§2); until then production returns 503
   `SMS_NOT_CONFIGURED` by design.
4. **Quiz + grading** — take the quiz, submit; backend grading (positive /
   negative marks) is the source of truth; result summary renders.
5. **Expiry** — an expired link (`publicExpiryDate`) returns 410 at the API
   and renders the expired state.
6. **Admin analytics** — guest participants appear for admins (unchanged
   admin-only gating).
7. **Backend log** — `Public quiz web app URL` shows the static site URL, and
   no `WEB_APP_URL is not set` warning.

## 5. What stays where

- **Vercel (`eyeconicmentors.vercel.app`)** — admin dashboard, untouched.
- **Render backend (`eyeconic-app-prod-1r8o.onrender.com`)** — all APIs,
  OTP, grading, persistence; single source of truth.
- **Render static site (`eyeconic-public-web`)** — public quiz web UI (+ the
  same admin dashboard bundle at its own URL, so admins have a
  fully-current fallback even while Vercel is not deploying).
