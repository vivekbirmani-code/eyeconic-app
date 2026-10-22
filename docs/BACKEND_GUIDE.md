# Eyeconic Backend — The Complete Guide

> Written 2026-10-22, based on the code at commit `7c9276f` ("Achha, mai kya karu phir").
> Everything here was read directly from `backend/` source code, not guessed.
> If the code changes a lot, revisit the sections that matter to you.

**How to read this guide:** Sections 1–6 give you the mental model. Sections 7–25 explain every feature and its workflow step by step. Sections 26–32 are reference material (event catalog, security, env vars, and a complete list of all ~160 API endpoints).

---

## Table of contents

1. [The big picture](#1-the-big-picture)
2. [Tech stack and folder map](#2-tech-stack-and-folder-map)
3. [How a request travels through the server](#3-how-a-request-travels-through-the-server)
4. [Accounts, roles and permissions](#4-accounts-roles-and-permissions)
5. [The feature freeze — what is ON and OFF right now](#5-the-feature-freeze--what-is-on-and-off-right-now)
6. [The database at a glance (33 collections)](#6-the-database-at-a-glance-33-collections)
7. [Authentication workflows](#7-authentication-workflows)
8. [Users and profiles](#8-users-and-profiles)
9. [Subjects and the question bank](#9-subjects-and-the-question-bank)
10. [Importing questions from Excel/CSV](#10-importing-questions-from-excelcsv)
11. [Media: uploads, Cloudinary and cleanup](#11-media-uploads-cloudinary-and-cleanup)
12. [Quizzes: creation and structure](#12-quizzes-creation-and-structure)
13. [Taking a quiz: the attempt lifecycle](#13-taking-a-quiz-the-attempt-lifecycle)
14. [Results and analytics](#14-results-and-analytics)
15. [Leaderboards and live updates](#15-leaderboards-and-live-updates)
16. [Public quizzes and guest leads (the share-link funnel)](#16-public-quizzes-and-guest-leads-the-share-link-funnel)
17. [AI proctoring](#17-ai-proctoring)
18. [Daily PYQ (previous-year questions)](#18-daily-pyq-previous-year-questions)
19. [Mini GT (mini grand test)](#19-mini-gt-mini-grand-test)
20. [Groups, chat and calls](#20-groups-chat-and-calls)
21. [Mentorship: mappings, assignments, admin overview](#21-mentorship-mappings-assignments-admin-overview)
22. [Free users and the website integration](#22-free-users-and-the-website-integration)
23. [Settings and kill switches](#23-settings-and-kill-switches)
24. [Email delivery](#24-email-delivery)
25. [Push notifications](#25-push-notifications)
26. [Real-time events catalog (Socket.IO)](#26-real-time-events-catalog-socketio)
27. [Background jobs and startup migrations](#27-background-jobs-and-startup-migrations)
28. [Security model in one page](#28-security-model-in-one-page)
29. [Infrastructure, environment variables, deployment](#29-infrastructure-environment-variables-deployment)
30. [Testing](#30-testing)
31. [Quirks and things worth knowing](#31-quirks-and-things-worth-knowing)
32. [Complete API reference](#32-complete-api-reference)

---

## 1. The big picture

Eyeconic is a NEET-PG mentorship product. It has **four moving parts**, and this backend is the brain of all of them:

| Part | Where it lives | What it does |
|---|---|---|
| **Mobile app** | Root of this repo (`app/`, `components/`, `services/`) — Expo / React Native | The app admin, mentors and students log into. Tests, analytics, chat, daily PYQ, Mini GT, rank predictor UI. |
| **Public web app** | `client/` folder — Vite + React | The browser app that **strangers** (leads) use to take a shared public quiz. Deployed separately; its URL is in `WEB_APP_URL`. |
| **This backend** | `backend/` folder — Node.js + Express | The single source of truth: database, all business rules, grading, deadlines, proctoring decisions, real-time chat/calls, emails, push. Hosted on Render at `https://eyeconic-app-prod-1r8o.onrender.com`. |
| **Marketing website + its server** | Separate repo ("eyeconic-main"), `https://www.eyeconicneetpg.com` + `https://eyeconic-server.vercel.app` | The Rank & Branch Predictor lives there. Its server talks to this backend through a private, token-protected integration API (`/api/integration/v1`). |

The key idea: **the apps are mostly screens — the backend owns all the truth.** Scores, deadlines, correct answers, who attempted what, whether an attempt looks suspicious — every decision of consequence is computed on the server. The client can suggest, but never decide.

There are two kinds of humans:

- **Registered users** — admin, mentors, paid students (~118, September 2026), and free users (signed up via website or OTP signup).
- **Guests (leads)** — anonymous people who open a public quiz link in a browser, verify their **email** with an OTP, and take the quiz. They never get a User account; they get a temporary "guest token".

## 2. Tech stack and folder map

| Technology | Used for |
|---|---|
| Node.js + Express 4 | HTTP API (~160 endpoints across 24 routers) |
| MongoDB via Mongoose 7 | All data (33 models). Production is MongoDB Atlas |
| Socket.IO 4 | Real-time: chat relay, calls (WebRTC signaling), live leaderboard, proctoring warnings |
| JWT (`jsonwebtoken`) | Login tokens for users, guests, and proctoring prechecks |
| bcryptjs | Password hashing (10 salt rounds) |
| Multer | File uploads in memory (Excel, images, chat files) |
| Cloudinary | All images/files (question images, chat attachments, profile pictures) |
| Nodemailer (SMTP) + Resend API | Email delivery with automatic fallback |
| firebase-admin + Expo push | Push notifications (FCM preferred, Expo fallback) |
| exceljs + xlsx | Excel/CSV parsing and styled Excel report exports |
| Jest + supertest + mongodb-memory-server | ~1250 tests, run in-band |

```
backend/
├── server.js            # The whole wiring: middleware, routes, Socket.IO, background jobs
├── config/              # cors.js, featureAvailability.js (the freeze flags)
├── constants/           # question.js (question types)
├── middleware/          # auth, guestAuth, serviceAuth, featureGate, rate limits, errorHandler...
├── models/              # 33 Mongoose schemas (the database)
├── routes/              # 24 Express routers (one per feature area)
├── utils/               # All business logic (grading, deadlines, proctoring/, mailer, exports...)
├── scripts/             # One-off ops scripts (imports, backfills, verify harnesses)
└── tests/               # unit/ + integration/ (supertest against a real app + in-memory Mongo)
```

## 3. How a request travels through the server

Every HTTP request passes through this pipeline, in order (`server.js`):

1. **CORS** — allowed origins come from `ALLOWED_ORIGINS` env, plus defaults for dev (`localhost:5173`, `localhost:3000`) and the production web app, plus `WEB_APP_URL`. Requests with **no** Origin header (mobile app, curl, server-to-server) are always allowed.
2. **requestId** — every request gets an ID (from `X-Request-Id` or freshly generated), echoed back on the response and included in every error and log line. When something breaks, this ID is how you find it in the logs.
3. **Body parsing** — JSON and form bodies up to **50 MB** (big enough for base64 Excel imports). Malformed JSON gets a clean 400 with code `INVALID_JSON` instead of a crash.
4. **Request logging** — one structured JSON log line per request (method, path, status, duration, requestId). Bodies are never logged (they can contain passwords).
5. **The route** — see the full list in section 32.
6. **404 handler** — unknown paths get a JSON 404, never an HTML error page.
7. **Global error handler** — catches anything thrown; never leaks stack traces or raw database errors to the client; maps upload errors to friendly messages (e.g. 413 for oversized files).

Two more details that matter in production:

- `trust proxy` is on, because Render terminates TLS in front of the app — this makes share links come out as `https://` and rate limits see the real client IP.
- **How the app connects:** the mobile app's `services/api.ts` creates one axios instance, sets its base URL per request (`https://eyeconic-app-prod-1r8o.onrender.com/api` in production, your LAN IP + `:3000` in dev), attaches the saved JWT as `Authorization: Bearer <token>`, uses a 30-second timeout, and retries up to 3 times with exponential backoff — but only for GETs (plus login/OTP posts), and never for a 503 `FEATURE_DISABLED`.

## 4. Accounts, roles and permissions

There are **three user roles** (`User.role`) plus two non-user identities:

| Identity | What they can do |
|---|---|
| **admin** | Everything: create/edit users and roles, reset passwords, manage groups and mentor assignments, subjects, question bank, create/import/delete quizzes, share links, retest decisions, question-report resolution, all analytics + exports, proctoring review/overrides, settings toggles. |
| **mentor** | Chat and call in their groups, create study assignments for *their* students, verify/send-back assignments, see analytics **scoped to their own students only** (never guest data, never external cohorts). |
| **student** | Take assigned quizzes (and any Mini GT), save answers, submit, see own results/analytics, chat (read/receive/send), mark assignments complete, fill own profile. Cannot start calls. |
| **guest** (not a User) | A verified-email lead from a public quiz link. Gets a 4-hour guest JWT that works **only** on public-quiz endpoints. Rejected everywhere else by design. |
| **service** (not a User) | The website's server, authenticating with a shared secret `INTEGRATION_SERVICE_TOKEN`. Only two endpoints accept it. |

How enforcement works:

- `auth` middleware reads the JWT from the `Authorization: Bearer` header (or `?token=` for downloads), verifies it, **re-fetches the user from the database on every request** (so deleted users and role changes take effect instantly), and rejects guest-kind tokens.
- `authorize('admin')` / `authorize('admin','mentor')` gates by role.
- Many routes add "target" checks — a student can only read their own data, a mentor only their own students'.

## 5. The feature freeze — what is ON and OFF right now

Since September 2026 the backend runs in **quiz-only mode**. This is a deliberate, reversible freeze — nothing was deleted:

| Feature flag | State | What it controls |
|---|---|---|
| `quizzes` | ✅ ON | Quizzes, question bank, subjects, daily PYQ, Mini GT, public quizzes, student/free-user analytics |
| `integration` | ✅ ON | Website handoff + free-user signup |
| `aiProctoring` | ✅ ON (since 2026-10-21) | Proctoring feature flag (still needs 2 more gates, see §17) |
| `chat` | ❄️ OFF | Groups, messages, upload/chat, chat socket events |
| `mentorship` | ❄️ OFF | Mentor-students, student-subjects, assignments |
| `userManagement` | ❄️ OFF | Most of users + settings (see allowlist below) |
| `adminOverview` | ❄️ OFF | Admin overview dashboard |

- The flags live in `backend/config/featureAvailability.js`. Frozen routers answer **503 `FEATURE_DISABLED`** for everything except a small per-router **allowlist** of endpoints the quiz workflow still needs — e.g. user pickers, `PUT /profile`, push-token saves, `GET /api/groups`, `GET /api/upload`, `GET /api/settings/public`, and (Phase 9) `GET /api/settings` + `PUT /api/settings/proctoring-enabled` so the emergency kill switch stays usable during the freeze.
- The same flags are **mirrored in two client files** (`utils/featureAvailability.ts` in the app, `client/src/config/features.ts` on the web) so all three agree. To re-enable a feature, flip the flag in all three.
- Frozen routers still run `auth` **before** the gate, so an expired session gets a proper 401 (which logs the client out) instead of a confusing 503.

## 6. The database at a glance (33 collections)

| Group | Collections |
|---|---|
| **People** | `User` (roles, profiles, push tokens, groups, mentors, unseenQuizzes), `Guest` (verified-email leads), `GuestOtp` (10-min OTP challenges), `Otp` (signup/reset OTPs) |
| **Content** | `Subject`, `Chapter`, `Topic` (legacy refs), `QuestionBank`, `QuestionReport` (student flags on questions) |
| **Tests** | `Quiz`, `QuizAttempt`, `GuestAttempt`, `DailyPyqSet`, `DailyPyqAttempt` |
| **Proctoring** | `ProctoringConsent`, `ProctoringSession`, `ProctoringEvent`, `ProctoringViolation`, `ProctoringOverride` |
| **Communication** | `Group`, `Message`, `MessageReadStatus`, `ReadStatus` (per-group read cursor), `Call`, `EmailDeliveryLog` |
| **Mentorship** | `MentorStudentAssignment`, `StudentSubjectAssignment`, `Assignment` (study tasks) |
| **Ops** | `AppSettings` (singleton toggles), `WebHandoffCode` (app→website login codes) |

Two habits used everywhere:

- **Soft deletes** — questions, subjects, quizzes are deactivated (`isActive: false` / `isDeleted: true`), never destroyed. Old attempts stay gradeable and history stays intact.
- **Frozen snapshots** — when an attempt starts, the server copies everything it needs at that moment (questions' metadata, section definitions, proctoring policy, the guest's name/email/phone). Later edits to the quiz or bank **never rewrite a finished attempt's history**.

## 7. Authentication workflows

Passwords are hashed with bcrypt. Login tokens are JWTs valid **7 days**, carrying `{ userId, role }`.

### 7.1 Login — `POST /api/auth/login`

1. Email + password → user looked up by lowercased email → bcrypt compare. Wrong anything = one generic "Invalid email or password" (so nobody can probe which emails exist).
2. Sign a 7-day JWT.
3. **Guest-attempt linking:** if the app sends the device's `guestId`, any completed guest attempts (from public quizzes taken before signing up) are copied into real `QuizAttempt`s and marked linked — the student's public history follows them into their account.
4. Return token + sanitized user.

### 7.2 OTP signup — gated by an admin toggle

Public self-signup is **OFF by default** (`AppSettings.signUpEnabled`, admin can flip it via `PUT /api/settings/signup-enabled`; the login screen probes `GET /api/settings/public`). While off, `send-otp` refuses before revealing whether an email is registered.

1. `POST /api/auth/send-otp` → 6-digit code emailed (Nodemailer), stored with a 10-minute TTL. Rate limits: 3 sends per email / 10 min, minimum 60 s between sends.
2. `POST /api/auth/signup` → name + email + password + the OTP. Re-checks the toggle (in case it was switched off after the OTP went out), verifies the OTP, creates a `student` with `isFreeUser: true`, returns a 7-day JWT. Brute-force limit: 5 failed verifies / 15 min per email.

### 7.3 Forgot password — `POST /api/auth/forgot-password-send-otp` then `/forgot-password-reset`

Same OTP mechanics, but this flow **does** confirm the account exists (404 "No account found") — intentional, since you can only reset an account that exists. Reset sets a new bcrypt password. Existing JWTs are *not* invalidated (they're stateless and expire on their own).

### 7.4 App → website login bridge (`WebHandoffCode`)

Lets a signed-in app user open the marketing website already logged in, without putting a JWT in a URL:

1. App calls `POST /api/auth/web-handoff` → server deletes any old code for the user, generates a 32-byte one-time code, stores **only its SHA-256 hash** with a **120-second** TTL, and returns `https://www.eyeconicneetpg.com/app-link?code=...`.
2. The website's server exchanges that code at `POST /api/integration/v1/handoff/consume` (protected by the service token AND a per-IP failure brake of 20/10 min). The consume is an atomic single-use flip — replaying or racing the code gets nothing.
3. The backend returns a fresh 7-day JWT; the website keeps it in an HttpOnly session cookie.

### 7.5 The three token kinds (they never mix)

| Token | Payload | Lifetime | Accepted by |
|---|---|---|---|
| User JWT | `{userId, role}` | 7 days | all `/api/*` routes (except where guest-only) |
| Guest JWT | `{kind:'guest', guestId}` | 4 hours | only `/api/public/*`; explicitly rejected by user routes |
| Precheck JWT | `{kind:'proctoring_precheck', studentId, quizId, policyHash...}` | 30 min | only proctoring consent + quiz start |

## 8. Users and profiles

Endpoints under `/api/users` (admin-only unless noted):

- **List / search / by-role** — admin only; results always exclude passwords.
- **Create / update / change email / reset password** — admin only. Email changes check collisions (pre-check + race-safe). Password resets are how the shared-password cohort gets reset.
- **`PUT /profile`** (self) — students fill either `freeUserProfile` (year, issues, resources, readiness) or `studentProfile` (MBBS batch, college, attempt number, target branch, subscriptions...). Sets `isProfileComplete`.
- **Profile pictures** — upload up to 5 MB; the file type is verified by **magic bytes**, not the claimed mime; goes to Cloudinary folder `eyeconic_profile_pictures` with a 400×400 face-crop; the old image is deleted on replace. Unconfigured Cloudinary = clean 503.
- **Push tokens** — `POST /push-token` (Expo) and `POST /fcm-token` (raw FCM). These power every push notification (§25).
- **`GET /:id`** — any logged-in user can fetch any user's public card (used for chat member lists).
- **`unseenQuizzes`** — an array on each User; quizzes push their id in on assignment (the "new test" badge) and it's cleared when the student opens their quiz list.

## 9. Subjects and the question bank

### Subjects

`Subject` = name + year (1st–4th) + display order. Admins create/update/deactivate (soft delete). `Chapter`/`Topic` still exist but the question bank no longer uses them — the **string `topicName`** (plus `subtopicName`, `system`) is the canonical tagging now.

### QuestionBank model

One document = one question. Key fields:

- **Identity:** `subject` (required), `topicName` / `subtopicName` / `system`, `questionType`, `tags`, `difficulty`, optional external `qid` (must be unique).
- **Six question types** (`constants/question.js`): `mcq_single`, `assertion_reason`, `match_the_following`, `image_based`, `multiple_correct`, `numerical`.
- **Content:** question text + image, up to 6 options (text or images), assertion/reason pair, columnA/columnB for matching, `correctAnswer`, explanation + image, marrow code, source.
- **`correctAnswer` shape depends on type:** option index (single/image/assertion), array of indexes (multiple correct), a `{"0":"2"}` left→right map (matching), or a number (numerical).
- **`dedupKey`** — server-computed, never client-writable (see below).

### The dedup contract (very important)

A **duplicate question = same subject + same question text**, ignoring case and all whitespace differences. The text is normalized (lowercased, all whitespace runs collapsed to one space) and combined with the subject id into `dedupKey`.

Enforcement is three layers deep so it can't be bypassed by timing:

1. Pre-check lookup before every create/update/import row.
2. A save hook re-stamps the key on every write.
3. The final authority: a **partial unique index** on `dedupKey` that only covers *active* questions — so a race loser gets an E11000 error (mapped to 409, or to a "skipped duplicate" on imports), and soft-deleted questions drop out of the index so their text can be re-imported fresh.

### Endpoints (`/api/question-bank`)

| Endpoint | Who | What |
|---|---|---|
| `GET /` | any user | Filter by subject/topic/type/difficulty/tag + text search. **Students never receive `correctAnswer`/`explanation`/assertion/reason/columns** (stripped from the query). |
| `POST /`, `PUT /:id` | admin | Create/update with full validation; duplicates → 409. |
| `DELETE /:id` | admin | Soft delete (`isActive: false`). |
| `GET /stats`, `GET /stats/summary` | admin / any | Total + per-subject counts. |
| `GET /by-subjects` | admin | Paginated picker for manual quiz selection. |
| `GET /import-template` | admin | Downloads the canonical `.xlsx` import template. |
| `POST /bulk-import` (+`-base64` for RN) | admin | Import — see §10. |

## 10. Importing questions from Excel/CSV

One parser (`utils/excelParser.js`) serves both the question-bank import and the quiz-from-Excel import. Behavior contract:

- **Parse problems are "fatal" and never crash the request** — the parser returns `{fatal: {code, message, hint}}` for unreadable files / no sheets / no rows, and the route maps that to a 400 with a hint.
- **Row problems are collected**, not fatal — reported as `"Row N: ..."` messages (capped at 50).
- **Columns:** SUBJECT, TOPIC, SUBTOPIC, SYSTEM, QUESTION_TYPE, DIFFICULTY, TAGS, QUESTION, Q_IMAGE, SOLUTION, SOLUTION_IMAGE, OPTION1–6, O_IMAGE_1–6, ASSERTION, REASON, COLUMN_A, COLUMN_B, CORRECT, QID, MARROW_CODE (+ friendly aliases like TYPE, EXPLANATION, "QUESTION NO"). CSV is auto-detected; encoding forced to UTF-8 to avoid mojibake.
- **CORRECT accepts many shapes:** letter (A–F), 1-based number, exact option text, "A,C,E" for multiple-correct, "1-C,2-A,3-B" for matching, plain number for numerical.
- **Subject aliases** map NEET shorthand (OBG, ENT, PSM, ortho, paeds...) to canonical subjects; unknown subject = row error.
- **Legacy tech-team sheets** missing whole columns get deterministic defaults (type inferred from image presence, difficulty medium, etc.).
- **Duplicates** are skipped and counted, split into "already in bank" vs "earlier row in this file". A sheet where every valid row is a duplicate is a *successful no-op*, not an error.
- **Images move to Cloudinary at import time:** any remote image URL (Google Drive etc.) is downloaded and re-uploaded to Cloudinary folder `eyeconic_questions` (4 rows in parallel). A failed transfer **never fails the row** — the direct URL is kept and a warning returned, classified as `download` (source link dead) or `upload` (Cloudinary hiccup, direct URL still loads). A per-image summary feeds the app's "Image Upload Summary" popup.

## 11. Media: uploads, Cloudinary and cleanup

Cloudinary is the **authoritative image store** for everything. Routes under `/api/upload`:

- **`POST /`** — single image field, any resource type, folder `eyeconic_app`. Used for question/option images. Allowlisted through the freeze.
- **`POST /chat`** — chat attachments, max **10 MB**: images, PDF, doc/docx, xls/xlsx. Documents upload as `raw` resources with a sanitized id (no extension, to sidestep Cloudinary's default PDF-delivery block).
- **`GET /download-proxy`** — the backend fetches a Cloudinary URL server-side and streams it inline. Exists because Android Chrome chokes on direct Cloudinary URLs. Only `https://res.cloudinary.com/` URLs are allowed.
- **Daily cleanup cron** — chat attachments older than **10 days** are deleted from Cloudinary and replaced in the message with an "expired media" placeholder (failures keep the original). Runs at boot and every 24 h.

## 12. Quizzes: creation and structure

### The Quiz model in plain words

| Field | Meaning |
|---|---|
| `title` | Must be unique among active, non-deleted quizzes (enforced in route code → 400 `DUPLICATE_TITLE`). |
| `subject` / derived `subjectNames` | One required subject ref; real subject names come from the questions. |
| `testType` | `daily`, `weekly`, `grand`, `mini`. **`mini` quizzes are self-serve** — every student can start them without assignment. |
| `duration` | Minutes, must be a positive integer. |
| `questions` | Ordered QuestionBank refs — the order defines question indexes inside attempts. |
| `positiveMarks` / `negativeMarks` | Quiz-wide marking. Defaults **+4 / −1** (NEET). `totalMarks` auto-computes as questions × positiveMarks. |
| `scheduledDate` / `expiryDate` | The availability **window** for registered students. Optional; end must be after start. |
| `assignedStudents` / `assignedMentors` | Who sees it. |
| `assignToAllFreeUsers` | Quiz belongs to every free user, including ones who sign up later. |
| `shareSolution` | Default **true** — whether students see correct answers/explanations on results. |
| `lockSectionsAfterSubmission` | Default **true**, and "missing = ON". NEET-style section locking (§13). |
| `sections` | Optional list of `{name, duration, selectionType, questions}`. **Section durations must sum exactly to the quiz duration**; a question can't be in two sections; `mixed` sections auto-distribute leftovers. |
| `shareToken` / `isPublic` / `publicExpiryDate` | Public sharing (§16). |
| `proctoring` | Strictly opt-in subdoc (§17). Absent can never enable. |
| `isActive` / `isDeleted` | Soft delete support. |

**There is no `attemptsAllowed` field.** One attempt per quiz is enforced at `/start` (any prior `completed` or `auto_submitted` attempt blocks a restart). Extra attempts happen only through the retest workflow.

### Three ways to create a quiz (all admin-only)

1. **`POST /create-from-bank`** — pick questions explicitly, or let the server **randomly sample** N questions per subject (with optional filters: tags, topics, difficulty, type...). Validates everything (duration, window, title, ObjectIds, proctoring config), derives sections, computes marks.
2. **`POST /import-excel`** — one Excel = questions + quiz in one shot. Reuses the §10 parser and validation. Extra behavior:
   - Title-duplicate check runs **before** any question is created.
   - Accepts the same **proctoring** opt-in as `create-from-bank` (§17), as a JSON-string form field — validated through `parseProctoringConfig` before any question is created; absent = unproctored.
   - Dedup outcomes per row: **reuse** existing question, **enrich** (if the new row has images and the stored one doesn't, images are transferred to Cloudinary and merged in), or **create** new.
   - **Rollback guarantee:** every question id created by this import is tracked; if anything fails afterwards, exactly those questions are deleted — no half-imports.
3. **`POST /:id/duplicate`** — "Copy of ..." with questions and settings; `assignedStudents` not copied; **proctoring config is inherited verbatim** (duplicating an armed quiz never silently disarms it).

Update (`PUT /:id`) re-validates the window against the *effective* final state and re-derives sections. Delete (`DELETE /:id`) is soft: it also revokes the public share, removes the quiz from everyone's `unseenQuizzes`, pushes a "Test Removed" notification, and emits `quiz_deleted` over sockets.

## 13. Taking a quiz: the attempt lifecycle

This is the heart of the backend. Every rule below is enforced **server-side** — the client's clock, its answers' correctness flags, and its auto-submit claims are never trusted.

### 13.1 Start — `POST /api/quizzes/:id/start` (student)

Checks run in this order, and **a failed proctored start consumes nothing** (no attempt row is left behind):

1. Quiz exists, is active, not deleted.
2. **Assignment:** assigned, OR `assignToAllFreeUsers` + free user, OR `testType === 'mini'`.
3. **Window:** before `scheduledDate` → 403 "not started yet"; past `expiryDate` → 403 (and any dangling in-progress attempt is finalized first).
4. **Resume:** if an in-progress attempt exists, it is resumed (earliest one wins). Deadlines are enforced lazily *before* resuming — an overdue attempt comes back as "finalized" instead of resurrecting.
5. **One attempt:** any prior finalized attempt without an approved retest → 400 "already completed".
6. **Proctoring gating** (if the quiz is armed): recorded consent for the *current* policy version + a valid precheck token are required, else 403 with a specific code.
7. The attempt is created with three **frozen snapshots**: the section definitions + states (if section-locked), the server-computed `durationDeadline` (flat attempts only), and the proctoring policy snapshot.
8. Double-taps / two tabs / React StrictMode double-mounts **converge**: concurrent starts resolve to the earliest attempt; losers get the winner's resume payload instead of a second attempt.

### 13.2 During the test

- **`PUT .../answer`** — saves one answer by `questionIndex`. The server resolves the real `questionId` from the quiz (the client's copy is only a consistency check). Writing into a non-active section → 403 `SECTION_LOCKED`.
- **Section locking** (when on — the default): the quiz is split into timed sections; you can only answer in the *currently active* one. **`POST .../sections/:sectionIndex/submit`** closes the active section and starts the next one's clock at that instant. Closing the **last** section finalizes the whole attempt. Idempotent (double-clicks are safe), guarded by an atomic compare-and-swap so two racing submits can't both win.
- **`POST .../save-progress`-equivalent for guests only** — registered attempts save per-answer (above); the public flow has its own autosave (§16).
- **`POST .../tab-switch`** — legacy telemetry (web visibility changes): increments counters, rate-limited 60/min. For proctored attempts it also dual-writes a `TAB_HIDDEN` proctoring event.

### 13.3 Deadlines — the one policy to remember

> **effectiveDeadline = min(startTime + duration, quiz window end)** — plus a 30-second grace for network delay.

- The stored `durationDeadline` stays pure; the min() is recomputed from the **live** quiz document on every touch, so an admin shortening or extending the window mid-attempt takes effect immediately.
- **Lazy enforcement:** every route that touches an attempt (answer, submit, section submit, tab-switch, proctoring events, resync) first checks "is this attempt overdue?" and finalizes it as `auto_submitted` before doing anything else. A late client payload is never accepted for grading — the attempt is graded from what's **already stored**.
- **The 60-second sweep:** a background job (§27) finalizes overdue attempts whose owner never comes back (app closed, window closed). The lazy checks remain the hard gate; the sweep just makes results/analytics complete. Env switches: `QUIZ_SWEEP_DISABLED`, `QUIZ_SWEEP_INTERVAL_MS`.

### 13.4 Submit — `POST .../submit`

All finalize paths (manual submit, last-section submit, expiry, proctoring auto-submit, sweep) converge on **one shared function**:

1. **Grading** — for every question: correct → +positiveMarks; wrong → −|negativeMarks|; **skipped → 0, never penalized**. Type-aware comparison (set-equality for multiple correct, exact mapping for match-the-following, numeric equality for numerical). Each answer gets a frozen `metadataSnapshot` (subject/topic/type/tags at grading time).
2. **Status is decided by the server:** within the deadline → `completed` (manual) or `auto_submitted` (client timer); past the deadline → `auto_submitted` **regardless of what the client claims**, with a machine-readable `autoSubmitReason` (`duration` or `quiz_window`).
3. **Atomic finalize** (compare-and-swap on `status: 'in_progress'`) — exactly one winner across all racing paths; everyone else gets an idempotent "already submitted" response.
4. Winner-only side effects: proctoring session closes, `quiz_submitted` socket event to the student, leaderboard rooms get a refresh nudge, admins + the student's mentor get a "quiz completed" alert (socket + push).

### 13.5 Results — `GET .../results`

- Student sees own; mentor sees assigned students'; admin sees all (plus guest attempts).
- Returns summary (correct/wrong/skipped/marks/%/accuracy/time), per-question performance, wrong-question list, frequently-missed, and grouped rows.
- **`?groupBy=section|subject|topic|tag`** (default section; section falls back to subject on sectionless quizzes). Group rows always **sum exactly to the summary**.
- Correct answers + explanations appear only if the quiz's *live* `shareSolution` is true.

### 13.6 Retests

Student requests (`request-retest`) → appears in admin pending lists (`/retests/pending`, `/retest-requests/pending`) → admin decides (`PUT /attempt/:attemptId/retest-decision`): **approve** (student can start a fresh attempt; the old one stays in history) or **reject** (clears the request).

### 13.7 Question reports

During an attempt a student can flag a question (`report-question`, ≤1000-char comment, snapshot of the question text at report time, one open report per attempt+question). Admins review and resolve/dismiss with a note (`GET /question-reports`, `PUT /question-reports/:reportId/resolve`). Reports never touch grading.

## 14. Results and analytics

All under `/api/quizzes/analytics/...`, mentor-scoped to their own students unless noted:

| Endpoint | What you get |
|---|---|
| `GET /stats` | Counts of active quizzes by type. |
| `GET /list`, `GET /tests/list` | Per-test assigned vs attempted counts (admin also sees guest attempt counts). |
| `GET /test-report/:testId` (+ `/csv`, `/excel`) | **The big test report.** Ranked per-student rows, totals; the Excel is a styled 3-sheet workbook (Student Performance / Question-wise Analytics / User Responses). Admin exports **include guest attempts** in aggregates and as unranked lead rows (with phone/verified/consent columns); mentor exports stay registered-only. |
| `GET /attempt/:attemptId/question-report` (+ `/csv`, `/excel`) | One attempt, question by question. Staff always see the answer key; correctness is never recomputed. |
| `GET /test/:testId` | Full test analytics: KPIs, score distribution, question stats, easiest/hardest question, ranked students, proctoring rollup (§17), guest participants (admin). |
| `GET /heatmap` | Students × last ~20 tests score matrix (admins additionally get one row per verified public lead). |
| `GET /me`, `GET /me/comparison` | Student self-service performance + **anonymous cohort comparison** (latest attempt vs everyone else's on the same quiz; aggregates are withheld below a privacy floor of 5 students; never exposes another student). |
| `GET /student/:studentId` (+ `/csv`, `/subjects`, `/performance`, `/frequently-missed`, `/questions/:questionId/history`) | Per-student deep dives: subject classification from frozen snapshots, strengths/weaknesses, recurring misses, per-question history. CSV export is admin-only. |

## 15. Leaderboards and live updates

- `GET /analytics/test/:testId/leaderboard` (+ `/export/csv`, `/export/excel`) — ranked board for admins/mentors. `?cohort=external` (public-quiz guests, with lead columns) is **admin-only**. Exports are built from the *same* loader as the live board, so they can never disagree.
- **Live updates:** when any attempt finalizes, the server emits `quiz_leaderboard_updated` to the room `leaderboard:<quizId>`. Joining that room requires a JWT-verified socket **and** a server-side admin/mentor check — students can never listen in. The event is deliberately just a *nudge* (which quiz changed); open dashboards refetch, so a burst of submissions collapses into cheap refreshes and tie-breaks always come from one code path.
- **Guests never enter student rankings** — anywhere. They are a separate, unranked population surfaced only to admins.

## 16. Public quizzes and guest leads (the share-link funnel)

This is the growth/lead-capture machine. All endpoints are public (no login) under `/api/public`.

### The funnel, step by step

1. **Admin mints a link** — `POST /api/quizzes/:id/generate-share-link` → a 32-character random token, `isPublic = true`, optional `publicExpiryDate`. The returned URL points **directly at the web app**: `${WEB_APP_URL}/public-quiz/<token>` — no backend hop. Revoking (`POST /:id/revoke-share-link`) **$unsets** the token and flips `isPublic` off — it must never `$set` the token to `null`: `shareToken` carries a UNIQUE SPARSE index, and sparse indexes still index explicit nulls, so a stored `null` works exactly once database-wide and every later revoke on any quiz dies with E11000 → 500 "Server error" (production bug, fixed 2026-10-22).
2. **Lead opens it** — the web page calls `GET /api/public/quiz/:shareToken` for safe metadata only (title, duration, question *count*, section structure — never the questions). Old backend-hosted links still work: `GET /api/public/share/:shareToken` 302-redirects to the web page (with `?invalid=1` for dead links).
3. **Lead capture** — name + email + phone + marketing consent → `POST .../lead/send-otp` → **email OTP** → `POST .../lead/verify-otp` → the lead is stored and a **4-hour guest JWT** is issued.
4. **Attempt** — `POST .../start` (device `guestId` in body, guest token if verified) → questions without answers → answer, autosave, submit (section-locked or flat) → `GET .../attempt/:attemptId/result` (guest token required).
5. **Admin sees everything** — guest attempts show up in admin analytics and exports (unranked, §14–15).

### The rules that make it robust

- **Identity = the OTP-verified email.** One email is one lead forever, across quizzes and devices. Phone is contact metadata only (Indian numbers normalized to +91, masked in most responses) — households sharing a phone are **never** fused into one person.
- **OTP security:** codes are stored **hashed** (HMAC-SHA256), live 10 minutes, are single-use, and are scoped to **one (email, quiz-link) pair** — a code from link A can't verify on link B. Rate limits: 3 sends/email/10 min with 60 s cooldown, 10 sends/IP/10 min, 5 failed verifies/email/15 min.
- **One live attempt per person**, enforced by **partial unique database indexes** (one in-progress attempt per lead on any device; one per anonymous device key). Races (double-tap, two tabs, StrictMode) converge: the loser's request is answered with the winner's resume payload.
- **One attempt per person per quiz, period:** a verified lead who already finalized gets 409 `QUIZ_ALREADY_ATTEMPTED`; namesakes and shared phones are not conflated (email matching is case-insensitive; cross-lead probing gets a bare 404 with no information).
- **The public link has its own expiry** (`publicExpiryDate`) which is **independent of the quiz's internal student window** — sharing a past test publicly is allowed and normal.
- **Same deadline doctrine as registered users:** effectiveDeadline = min(duration, link expiry) + grace; late submissions are graded from **stored** answers; the 60-second sweep covers guests who never come back; section-locked guest autosave **merges** into open sections only (a tampered client can't rewrite a submitted section).
- **Result access** requires the guest token, is scoped to that lead, and re-checks the live `shareSolution` flag.
- **Cross-device resume:** a verified lead can start on one device and resume on another; their anonymous device attempt is adopted under the lead on re-verification.
- **When a guest later signs up properly,** the login flow (§7.1) links their completed guest attempts into their real account.

### The `WEB_APP_URL` rollout switch

`utils/publicWebUrl.js` is the single source of truth for where share links point. Resolution order: `WEB_APP_URL` env → production web origin → `localhost:5173` in dev. Because the origin is baked into each link at generation time, **flipping `WEB_APP_URL` only affects newly generated links**. Don't confuse it with `WEBSITE_URL` (the marketing site, used for app→website handoff §7.4).

## 17. AI proctoring

**Purpose:** make unsupervised attempts reviewable. The phone's camera + app state produce *observations*; the server interprets them and stores an audit trail.

**Doctrine (baked into the code):** events are **observations, never verdicts** — words like "cheating" can't even be stored as event types. **No screenshots or images are ever uploaded.** Everything consequential (timestamps, severity, decisions) is server-computed.

### The three gates — all three must be ON

1. **Global kill switch** — `AppSettings.proctoringEnabled` (default **off**, fails closed on any error). Admin toggles it; flipping it off mid-test never touches in-flight attempts.
2. **Feature flag** — `aiProctoring` in `featureAvailability.js` (ON since 2026-10-21).
3. **Per-quiz opt-in** — `Quiz.proctoring.enabled: true`. An absent config can never enable proctoring.

### What the phone reports (event vocabulary)

| Category | Events |
|---|---|
| technical | SESSION_STARTED/RESUMED/CLOSED/DEGRADED, MODEL_UNAVAILABLE, HEARTBEAT_GAP (server-generated), CAMERA_UNAVAILABLE / PERMISSION_REVOKED / TRACK_ENDED / FEED_DARK / FEED_FROZEN |
| cv_observation | FACE_NOT_DETECTED / PARTIALLY_VISIBLE / OUT_OF_FRAME, MULTIPLE_FACES_DETECTED, HEAD_POSE_EXTREME / TURNED / REPEATED, ATTENTION_DEVIATION_SUSTAINED / REPEATED |
| integrity | TAB_HIDDEN, WINDOW_BLUR, APP_BACKGROUND, APP_INACTIVE (never counts as focus loss), EXIT_ATTEMPTED |
| system_action | WARNING_DELIVERED, AUTO_SUBMITTED, POLICY_ACTION_SKIPPED (server-generated audit records) |

Camera-vision events carry a 0–1 confidence (they're probabilistic); tab/window events are deterministic facts.

### Modes and the current default posture

The frozen policy per attempt supports per-family modes. **Global defaults (v3, set 2026-10-21) = warn on everything, auto-submit on nothing:**

- **focusEvents** `warn-only` (tolerated 3): each focus-loss episode warns. `warn-then-submit` exists but must be chosen explicitly per quiz (3 warns → final warn → 5th submits).
- **multipleFaces / facePresence** `warn`.
- **attention (head-turn)** `warn` — advisory banner on the 3rd look-away in a window. **Structurally can never cost an attempt** (no violation, zero risk weight, no submit mode exists).
- Camera problems and heartbeat gaps are recorded and warned, never auto-submitted. The only auto-submit paths are an explicit `warn-then-submit` focus ladder, or `violationAction: 'submit'` counting **only deterministic** violations — and CV-driven submits additionally need the OFF `proctoringStrictCv` gate.

### The flow, end to end

1. **Precheck** (`POST /api/quizzes/:id/proctoring/precheck-report`, 10/hour): the app reports device facts + checks (camera permission, face readiness, network...); the **server** decides PASS / RETRYABLE / FAIL / UNSUPPORTED (device floor: Android API ≥ 26, ≥ 3 GB RAM). PASS issues a **30-minute signed precheck token** bound to student + quiz + the exact policy hash — it can't be reused for another person, quiz, or after a policy change.
2. **Consent** (`POST .../consent`): stored against the current policy hash. If the admin later changes monitoring settings, consent is invalidated and the student must re-accept.
3. **Start gating:** consent + valid precheck token required to create an attempt on an armed quiz (403 with specific codes otherwise). **Resuming an in-progress attempt never re-gates** — you can't be kicked out mid-test by a re-consent demand.
4. **Session:** one `ProctoringSession` per attempt (uniqueness enforced in the DB).
5. **Event ingest** (`POST .../proctoring/events`): batches (≤50 events) with per-event `idempotencyKey` (duplicates are no-ops), 60 batches/min, one malformed event rejects the whole batch, ordering by server time (late/out-of-order batches are fine). Heartbeats piggyback on batches; silence past 90 s produces a server-generated `HEARTBEAT_GAP`. Sessions past 500 events are flood-flagged but still accepted.
6. **Rules engine** evaluates each fresh batch against the frozen policy → **violations** (persisted with unique derivation keys so replays can't double-count) → **warnings** delivered three ways: a `WARNING_DELIVERED` audit event, an instant socket push (`proctoring_warning`) to the student, and a queued action in the next batch response (for offline moments). If policy says submit: an `AUTO_SUBMITTED` event is written, then the **same** finalize path as a manual submit runs.
7. **Risk score** (0–100, recomputed after every batch): additive capped weights per signal, with a breakdown that sums exactly to the score. Bands (normal/low/moderate/high/critical) are triage labels only.
8. **Close & summary:** every finalize path closes the session and freezes a summary onto it. Zero violations + low risk → `clean`; anything else → `pending` review.
9. **Review surface:** `GET .../proctoring/timeline` (chronological episodes, violations, warnings, summary — frozen for closed sessions) and `POST .../proctoring/review` (admin only): confirm / dismiss / escalate + note + optional *display-only* adjusted score — **the platform never alters marks**.
10. **Monitoring summary:** each test's analytics include a proctoring block (per-attempt risk, violations, look-aways, multiple-face counts...) and the same columns ship in the report exports. A daily email digest exists but is dormant until `PROCTORING_DIGEST_RECIPIENTS` is set (no first-run email storm by design).
11. **Accommodations** (`/proctoring-overrides`, admin): per-student overrides (`attention_disabled`, `relaxed_thresholds`) applied only to the frozen copy at start; enforcement rules (focus, faces, camera) are deliberately **not** overridable.

**Policy snapshots:** at `/start` the effective policy (defaults ⊕ quiz config ⊕ accommodations) is hashed and **frozen onto the attempt** — write-once. Later admin edits never move the goalposts mid-test.

**Note:** public/guest quizzes are never proctored (precheck requires assignment, and the analytics rollup is registered-only).

## 18. Daily PYQ (previous-year questions)

A daily ritual: **10 questions per day**, one frozen set per IST date.

- **Selection** (`GET /api/daily-pyq/today`): from single-choice questions only, shuffled by a **deterministic random generator seeded by the date** — every server picks the same set. Questions used in the last 7 days are excluded when the pool allows. The set freezes atomically on first request of the day. Questions are served **without answers**; once you've submitted, "today" returns your graded attempt instead.
- **Submit** (`POST /submit`): idempotent (re-submit returns the existing attempt), must be for today's date (crossing midnight → 409 `DATE_MISMATCH`), graded server-side in frozen order, +4/−1, skips unpenalized, questions deleted after the freeze count as skipped. Light limiter: 15 submits/10 min.
- **Streaks:** current streak (anchored at today, or yesterday if today is untouched — an unfinished today doesn't break it) and best-ever.
- **History** + single-attempt detail endpoints (own attempts only).
- Pool too small → 503 `DAILY_PYQ_UNAVAILABLE`.

## 19. Mini GT (mini grand test)

A fixed-format **30-question shared test — 10 each from Psychiatry, Dermatology, Orthopaedics** — built as a normal quiz (`testType: 'mini'`) and run through the standard quiz engine.

- **`POST /generate`** (admin): samples per subject (prefers tagged questions, single-best-answer types), hard-errors with per-subject availability if any subject can't field 10. Assignment: `assignToAllFreeUsers: true` **plus** a snapshot of current free users; badges, socket event, and push notification fire on creation.
- **Self-serve:** every student sees the latest Mini GT without individual assignment (`GET /latest`, `GET /attempts`).
- **`GET /attempts/:attemptId/analysis`**: your result vs the **cohort** (everyone's latest finalized attempt on that quiz, deduped per student): percentile (self excluded), tier (Excellent ≥75 / Strong ≥60 / Developing ≥40 / Needs Focus — on accuracy), per-subject rows vs cohort averages, question heatmap, topic + concept-tag breakdowns (provenance tags like `excel-import` are excluded). Cohort stats are nulled below a privacy floor of 5 students.
- **Free users** get a trimmed analysis (score summary + subject table + tier) with an upsell message — stripped server-side.

## 20. Groups, chat and calls

*(Currently frozen — §5. Described as built.)*

### Groups

- Types: `general` (max **1 student** — effectively a private thread between that student and admins/mentors), `mentors` (no students), `admin` (admins only).
- Admins create/edit/manage membership and can **bulk-assign one mentor to many groups** in one call. Membership is mirrored onto each user's `groups` array, and sockets auto-join a user's group rooms on connect.
- Per-group **unread count** = messages newer than your per-group read cursor (`ReadStatus`, upserted by `POST /:id/read`).

### Messages

- Send (persisted) → push notification to every other member → live relay over sockets. Attachments (images/PDF/office files ≤10 MB) upload first via `/api/upload/chat`.
- **Read receipts:** one `MessageReadStatus` doc per (message, reader). Marking read moves the message `sent → delivered → read` (read = *all* other members read). "Seen by" list available per message. Batch marking for opening a chat.
- **Edits** (sender only) and **deletes:** "delete for me" (hidden only for you) vs "delete for everyone" (content blanked for everyone but **retained in the DB** for admin inspection).
- **HTTP is the source of truth; sockets are the live relay.** The socket `send_message` event only re-broadcasts; the client also POSTs for persistence + push.

### Calls (WebRTC, fully relayed through the backend)

- Only **non-students** can initiate (checked server-side from the verified socket identity, never a client claim). A `Call` document tracks participants, join/leave times, mute state.
- Targeted ringing: specific users get `incoming_call` on their sockets **plus a data-only FCM push** (so Android can show the call with the app killed). No targets = ring the whole group room.
- `call_offer` / `call_answer` / `call_ice_candidate` relay the WebRTC negotiation; join/leave/mute/end/decline update the Call doc and broadcast to the room.
- Every call leaves a **chat message**: starts as "X started a call", morphs into `call_end` (with duration), `call_missed`, or `call_declined`. Disconnects are cleaned up (last one out ends the call).

## 21. Mentorship: mappings, assignments, admin overview

*(Currently frozen — §5. Described as built.)*

- **Mentor ↔ student:** stored twice by design — `User.mentors[]` on the student is the live link, `MentorStudentAssignment` rows (unique mentor+student, deactivated rather than deleted) are the audit trail. The admin "replace mentor list" endpoint keeps both in sync.
- **Student ↔ subjects:** one `StudentSubjectAssignment` doc per student (admin-managed).
- **Study assignments** (the weekly plan engine — not quiz assignment): tasks typed *Main Video, Revision R1/R2/R3, Custom Mobile Mixed Bag, Myonebook Review, Other*, with duration and scheduled date. Status flow: `pending → completed` (student marks) `→ verified` (mentor approves with a comment) **or back to `redo`** (mentor sends it back with a reason). A `GET /week/:studentId` endpoint computes the Mon–Sun window server-side.
- Mentors can only create tasks for students actively assigned to them.
- **Admin overview:** every student with assignment stats (completion %, verification rate) + active mentor + profile completeness + last activity; every mentor with computed stats (active students, tasks created, verified in last 7 days, average completion); per-mentor drill-down.
- **Student analytics** (`/api/student-analytics/summary/:studentId`, live during the freeze): finalized attempts + subject rollup for mentor/admin.

## 22. Free users and the website integration

### Free-user analytics (`/api/free-user-analytics` — mentor/admin, live)

A "free user" = `role: student && isFreeUser: true`. These endpoints power the website's mentor dashboard:

- `GET /overview` — totals, DAU/WAU/MAU id-lists (from finalized quiz attempts + Daily PYQ submissions in IST windows), Mini GT + PYQ totals, platform-choice counts.
- `GET /ids` — the canonical free-user id list, so the website scopes its own predictor data to the identical population.
- `GET /users` (+ `/:id`) — searchable, paginated list and per-user drilldown (attempts, streaks, last active).
- `GET /performance` — subject-wise Mini GT aggregates, PYQ completion, top-10 streaks, drop-off list (inactive for N days, default 7), weekly usage counts.

### Website integration (`/api/integration/v1` — service-token only, live)

- `POST /handoff/consume` — completes the app→website login bridge (§7.4).
- `POST /free-user/signup` — the website's GT-Score-Predictor funnel creates free accounts here directly (no OTP — the caller is a trusted server with the shared secret; deliberately not gated by the admin signup toggle). Email collisions → 400 `EMAIL_TAKEN`.

## 23. Settings and kill switches

One singleton `AppSettings` document holds the global toggles. Every reader **fails closed** (missing document or DB error = "off"):

| Toggle | Default | Meaning |
|---|---|---|
| `signUpEnabled` | **false** | Whether public OTP signup is open. Probed (no auth) by the login screen via `GET /api/settings/public`. |
| `proctoringEnabled` | **false** | The proctoring kill switch — highest-precedence gate (§17). |
| `proctoringStrictCv` | **false** | Would allow probabilistic CV events to feed auto-submits. Stays OFF for V1. |

Admin-only `PUT` endpoints flip them and stamp who did it. During the freeze, `GET /api/settings` and `PUT /proctoring-enabled` are allowlisted so the emergency kill switch stays operable.

## 24. Email delivery

All email (signup OTP, password reset, guest-quiz OTP) goes through one mailer with a clear strategy:

1. **SMTP** (pooled transporter, bounded retries for transient failures — greylisting, throttling, network).
2. **Resend API fallback** if SMTP stays failed and `RESEND_API_KEY` is set.
3. A **hard rejection** ("mailbox doesn't exist") fails fast with an actionable "check the spelling" message — no fallback spamming.

Budgets: the whole chain is capped at 20 s (inside client timeouts); ≤3 attempts per provider. From-address precedence: `SMTP_FROM_EMAIL → SMTP_USER → RESEND_FROM_EMAIL → no-reply@eyeconicmentors.com`. In dev with no provider configured, OTPs print to the console instead of sending.

Every real send attempt writes an **`EmailDeliveryLog`** audit row (recipient, purpose, provider, status, attempts, error, duration) with a 30-day TTL — "sent" means the provider *accepted* it, the last thing observable.

## 25. Push notifications

Tokens: `User.fcmToken` (raw FCM, preferred — works with the app killed) and `User.pushToken` (Expo, fallback). Calls are sent as **data-only** pushes so Android's `onMessageReceived` can fire and start the call screen/foreground service; everything else carries a visible notification with a channel (calls/messages/tests).

| Trigger | Who gets it |
|---|---|
| New group message | other group members |
| Incoming call | targeted users |
| Quiz assigned (create / reassign / share) | assigned students — "New Test Assigned" |
| Mini GT generated | free users — "New Mini GT" |
| Quiz submitted | all admins + the student's active mentor |
| Quiz deleted | previously assigned students — "Test Removed" |

Socket events accompany most of these (§26) — push covers the app-closed case, sockets the app-open case.

## 26. Real-time events catalog (Socket.IO)

**Connection:** the client connects and registers with a **verified JWT** (`register_user` or handshake `auth.token`). The server maps socket→user (a claimed user id that doesn't match the token is ignored), auto-joins the user's group rooms, and only then can targeted events reach them.

**Client → server:** `register_user`, `join_room`, `leave_room`, `join_leaderboard` (admin/mentor check server-side), `leave_leaderboard`, `send_message`, `message_updated`, `message_deleted`, `call_initiate`, `call_offer`, `call_answer`, `call_ice_candidate`, `call_join`, `call_leave`, `call_mute`, `call_end`, `call_decline`, `get_active_call`.

**Server → client:** `receive_message`, `message_updated`, `message_deleted`, `group_added` / `group_removed` / `group_updated`, `data_updated` (admins), `user_updated` (admins), `new_quiz_assigned` (broadcast), `quiz_deleted` (broadcast), `quiz_submitted` (to the student), `quiz_leaderboard_updated` (leaderboard rooms), `quiz_completed_alert` (admins + mentor), `proctoring_warning` (to the student), `leaderboard_joined` / `leaderboard_error`, `incoming_call`, `call_initiated`, `call_joined`, `call_user_joined`, `call_user_left`, `call_user_muted`, `call_ended`, `call_declined`, `call_error`, `active_call`, `register_rejected`, `feature_disabled`.

Chat/call events are inert while the `chat` flag is off; quiz emissions keep working regardless.

## 27. Background jobs and startup migrations

Scheduled in `server.js` once the database connects:

| Job | Cadence | What it does |
|---|---|---|
| **Overdue-attempt sweep** | every 60 s (first run 10 s after boot) | Finalizes overdue in-progress attempts (registered + guest) that no one touched again — batch of 200, oldest first. Disable with `QUIZ_SWEEP_DISABLED=1`. |
| **Media cleanup** | every 24 h | Deletes Cloudinary attachments of chat messages older than 10 days. |
| **Proctoring digest** | every 24 h | Email digest of proctoring metrics; dormant until `PROCTORING_DIGEST_RECIPIENTS` is set; first run is 24 h after boot so restart loops can't email-storm. |

**One-time startup migrations** (all idempotent — they check what exists before touching anything): drop the legacy phone-keyed guest-OTP collection; merge duplicate-email guest leads and swap to the unique-email index; dedupe legacy duplicate live guest attempts and build the partial unique indexes. These exist because the guest identity model changed from phone to verified email in October 2026.

## 28. Security model in one page

- **Passwords:** bcrypt, 10 rounds. Login gives no hint about which emails exist.
- **Three token kinds that never interchange** (user / guest / precheck), all verified server-side; the socket layer verifies the same JWTs.
- **Server-authoritative everything:** question identity, correctness, grading, deadlines, submission status, proctoring verdicts, OTP verdicts — none of it trusts client claims. Client-sent `isCorrect`, `severity`, `riskScore`, `metadataSnapshot` etc. are stripped on arrival.
- **Atomic finalizes (compare-and-swap)** so racing submits/consume/start always have exactly one winner, with idempotent responses for losers.
- **Database-level uniqueness** as the last line of defense: dedupKey (questions), one-live-guest-attempt indexes, one-open-report index, session/attempt 1:1, one handoff code per user, derivation keys on violations.
- **Rate limits everywhere** (in-memory, per process — fine for the single Render instance): OTP sends/verifies, guest OTP sends/verifies, handoff consume attempts (per IP), tab-switch, proctoring events, precheck reports, daily-PYQ submits.
- **Secrets hygiene:** service token compared timing-safely and refused (503) if unset in production; guest OTPs stored HMAC-hashed; handoff codes stored SHA-256-hashed, single-use, 2-minute TTL; logs redact password/token/secret keys; CSV exports defend against formula injection; download-proxy only fetches Cloudinary URLs.
- **Fail-closed toggles:** every settings reader treats "can't read" as "off".
- **No user enumeration** on login/signup-OTP; forgot-password intentionally confirms existence (reset only works on real accounts).
- Known hygiene items to fix: see §31.

## 29. Infrastructure, environment variables, deployment

- **Hosting:** Render (single web service). Health checks: `GET /health` and `GET /api/health` always return 200 with dependency detail (database, JWT secret, email, Cloudinary); `/health/database` returns 200/503; `/health/auth` does a live sign+verify roundtrip. The service identifies itself at `GET /` as `eyeconic-api`.
- **Database:** MongoDB Atlas via `MONGODB_URI`. ⚠️ Production URI has **no database name**, so all production data lives in the Atlas default database literally named **`test`** — that's normal here, not an accident. Connection: 15 s server-selection timeout, IPv4 forced (Windows DNS quirk), pool 1–10, auto-reconnect; `requireDatabase` middleware 503s gracefully while disconnected (auth/OTP routes wait up to 8 s first).
- **Key environment variables:** `JWT_SECRET`, `MONGODB_URI`, `PORT` (default 3000), `SMTP_*` / `RESEND_API_KEY`, `OTP_HASH_SECRET`, `CLOUDINARY_*`, `FIREBASE_*`, `INTEGRATION_SERVICE_TOKEN`, `WEB_APP_URL` (public quiz web app), `WEBSITE_URL` (marketing site), `ALLOWED_ORIGINS`, `GUEST_JWT_EXPIRES_IN`, `WEB_HANDOFF_TTL_SECONDS`, `QUIZ_SWEEP_*`, `PROCTORING_DIGEST_*`. Startup logs warnings for anything critical missing.
- **Logging:** JSON lines to stdout with redaction; Render collects them. Port-in-use errors even print the owning PID and the exact command to kill it.

## 30. Testing

- `npm test` in `backend/` runs Jest **in-band**: ~50 integration suites (real Express app + in-memory MongoDB via `mongodb-memory-server`, driven by supertest) + unit suites for pure logic (grading, parsers, exports, proctoring utils).
- The test app is built via a `buildApp()` helper so routes/middleware run exactly as in production.
- Baseline at the time of writing: **1 pre-existing failure** (a featureGate test drifting because `aiProctoring` was flipped on for the rollout); everything else passes.
- `backend/scripts/` holds operational harnesses too: full proctoring lifecycle verification, public-flow browser verification, feature-freeze verification, student import, dedup backfill, image repair.

## 31. Quirks and things worth knowing

1. **A live Firebase service-account key is committed in `backend/utils/firebase.js`** (as a fallback when env vars are unset). It works, but it's a real credential in git — worth rotating and moving fully to env.
2. **All rate limits are in-memory** — they reset on restart and don't span processes. Fine for the current single Render instance; move to Redis before ever scaling horizontally.
3. **Mentor↔student is stored twice** (`User.mentors[]` live link + `MentorStudentAssignment` audit rows). They're kept in sync by the write path, but read paths use different stores — a drift would make screens disagree.
4. **Quiz-delete push has a dead branch:** it queries an `expoPushToken` field that doesn't exist on User (it's `pushToken`) — the Expo half of that one notification silently finds nobody; the FCM half works.
5. **Public `save-progress` doesn't filter by quiz** — ownership is checked by attemptId + device/lead, so it's safe, just wider than it looks.
6. **The freeze is mirrored in 3 files** (backend config, app `utils/featureAvailability.ts`, web `client/src/config/features.ts`). Flip all three together.
7. **Mini GT assignment is a snapshot:** generation snapshots current free users *and* sets `assignToAllFreeUsers`, so later signups are covered at start time — but the "assigned students" list in the DB won't include them by name.
8. **`GET /api/users/:id` is readable by any logged-in user** (needed for chat cards) — by design, but be aware.
9. **Guest OTP codes are scoped per (email, quiz-link)** and hashed — you can't replay a code from one link on another.
10. **Rollout trap (proctoring):** students need the new APK *before* being assigned an armed quiz — old builds don't run precheck/consent and will fail to start armed tests.

## 32. Complete API reference

Legend: 🔓 public · 👤 any logged-in user · 🎓 student · 🧑‍🏫 mentor · 🔧 admin · 🧑‍🏫🔧 mentor or admin · 🤖 service token · 🎭 guest token · ❄️ frozen (503 unless allowlisted) · ⚪ optional guest token

### `/api/auth` — authentication (live)

| Method & path | Who | Purpose |
|---|---|---|
| POST `/login` | 🔓 | Email + password → JWT (links guest attempts if `guestId` sent) |
| GET `/me` | 👤 | Current user profile |
| POST `/web-handoff` | 👤 | Mint one-time app→website login code |
| POST `/send-otp` | 🔓 | Email OTP for signup (checks `signUpEnabled`) |
| POST `/signup` | 🔓 | Verify OTP, create free student account |
| POST `/forgot-password-send-otp` | 🔓 | OTP for password reset (confirms account exists) |
| POST `/forgot-password-reset` | 🔓 | Verify OTP + set new password |

### `/api/users` — user management ❄️ (allowlist: pickers, profile, profile-picture, push tokens)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/` · GET `/search` · GET `/role/:role` | 🔧 | List / search / by role |
| POST `/` · PUT `/:id` · PUT `/:id/email` · POST `/:id/reset-password` | 🔧 | Create / update / change email / reset password |
| GET `/:id` | 👤 | Public user card |
| PUT `/profile` | 🎓 | Fill own student/free profile |
| POST `/profile-picture` · DELETE `/profile-picture` | 👤 | Upload/remove profile picture (Cloudinary) |
| POST `/push-token` · POST `/fcm-token` | 👤 | Register push tokens |

### `/api/groups` + `/api/messages` + `/api/upload` — chat ❄️ (allowlist: GET groups, POST upload)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/api/groups` | 👤 | My groups + unread counts (admins: all) |
| POST `/api/groups` · PUT `/:id` · POST `/:id/members` · DELETE `/:id/members/:userId` | 🔧 | Create/edit/manage membership |
| GET `/api/groups/:id` · GET `/:id/student-subjects` · POST `/:id/read` | 👤 | Group detail / member subjects / mark read |
| GET `/api/groups/mentor/:mentorId/assignments` · POST `/api/groups/bulk-mentor-assignment` | 🔧 | Mentor↔group bulk assignment |
| GET `/api/messages/group/:groupId` | 👤 | Fetch messages |
| POST `/api/messages` | 👤 | Send message (+push to others) |
| PUT `/api/messages/:id` | 👤 (sender) | Edit |
| POST `/api/messages/:id/read` · POST `/read-batch` · GET `/:id/read-status` | 👤 | Read receipts |
| DELETE `/api/messages/:id/me` · DELETE `/:id/everyone` · DELETE `/:id` | 👤 | Delete for me / everyone / legacy |
| POST `/api/upload` | 👤 | Image upload (live via allowlist) |
| POST `/api/upload/chat` | 👤 | Chat file upload (10 MB, images/PDF/office) |
| GET `/api/upload/download-proxy` | 👤 | Stream Cloudinary file (Android Chrome workaround) |

### `/api/quizzes` — quiz management (live)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/stats` | 🧑‍🏫🔧 | Quiz counts by type |
| GET `/` | 👤 | Quiz list (role-branched visibility + attempt status) |
| POST `/create-from-bank` | 🔧 | Create quiz (pick or random-sample questions) |
| POST `/import-excel` | 🔧 | Create quiz + questions from Excel (rollback-safe) |
| POST `/:id/duplicate` | 🔧 | Copy quiz |
| PUT `/:id` | 🔧 | Update (re-validates window/sections) |
| DELETE `/:id` | 🔧 | Soft delete + revoke share + notify |
| GET `/:id` · GET `/attempt/:id` | 👤 | Quiz detail / attempt detail (students never see answer keys here) |
| GET `/by-token/:shareToken` | 👤 | Resolve share token → quiz (students must be assigned) |
| POST `/mark-seen` | 🎓 | Clear unseen badge |

### `/api/quizzes` — taking a test (live)

| Method & path | Who | Purpose |
|---|---|---|
| POST `/:id/start` | 🎓 | Start/resume attempt (assignment, window, one-attempt, proctoring gating) |
| PUT `/:id/attempt/:attemptId/answer` | 🎓 | Save one answer |
| POST `/:id/attempt/:attemptId/sections/:sectionIndex/submit` | 🎓 | Submit one section (last one finalizes) |
| POST `/:id/attempt/:attemptId/submit` | 🎓 | Submit whole attempt |
| POST `/:id/attempt/:attemptId/tab-switch` | 🎓 | Legacy tab-switch telemetry |
| POST `/:id/attempt/:attemptId/report-question` | 🎓 | Flag a question |
| GET `/:id/attempt/:attemptId/results` | 👤 (scoped) | Results (`?groupBy=section\|subject\|topic\|tag`) |
| POST `/:id/attempt/:attemptId/request-retest` | 🎓 | Request retest |

### `/api/quizzes` — retest & report admin (live)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/retests/pending` · GET `/retest-requests/pending` | 🧑‍🏫🔧 / 🔧 | Pending retests |
| PUT `/attempt/:attemptId/retest-decision` | 🔧 | Approve/reject retest |
| GET `/question-reports` | 🔧 | Student question reports |
| PUT `/question-reports/:reportId/resolve` | 🔧 | Resolve/dismiss a report |

### `/api/quizzes` — analytics & reports (live)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/analytics/list` · GET `/analytics/tests/list` | 🧑‍🏫🔧 | Per-test counts |
| GET `/analytics/test-report/:testId` (+ `/csv`, `/excel`) | 🧑‍🏫🔧 | Full test report (admin: guests included) |
| GET `/analytics/attempt/:attemptId/question-report` (+ `/csv`, `/excel`) | 🧑‍🏫🔧 | Single-attempt question report |
| GET `/analytics/test/:testId` | 🧑‍🏫🔧 | Full analytics + proctoring rollup |
| GET `/analytics/test/:testId/leaderboard` (+ `/export/csv`, `/export/excel`) | 🧑‍🏫🔧 (`cohort=external`: 🔧) | Leaderboard + exports |
| GET `/analytics/heatmap` | 🧑‍🏫🔧 | Students × tests score matrix |
| GET `/analytics/me` · GET `/analytics/me/comparison` | 🎓🧑‍🏫 / 🎓 | Own performance / anonymous cohort comparison |
| GET `/analytics/student/:studentId` (+ `/csv` 🔧, `/subjects`, `/performance`, `/frequently-missed`, `/questions/:questionId/history`) | 👤 (scoped) | Per-student deep dives |
| GET `/analytics/:id` | 🧑‍🏫🔧 | Per-quiz aggregate |

### `/api/quizzes` — sharing (live)

| Method & path | Who | Purpose |
|---|---|---|
| PUT `/:id/share` | 🔧 | Legacy share settings update |
| POST `/:id/generate-share-link` | 🔧 | Mint public link + expiry |
| POST `/:id/revoke-share-link` | 🔧 | Revoke public link |
| GET `/:id/share-status` | 🔧 | Link status/expiry |

### `/api/quizzes` — proctoring (live)

| Method & path | Who | Purpose |
|---|---|---|
| POST `/:id/proctoring/precheck-report` | 🎓 | Device readiness → verdict + 30-min precheck token |
| POST `/:id/proctoring/consent` | 🎓 | Record consent (policy-hash bound) |
| POST `/:id/attempt/:attemptId/proctoring/events` | 🎓 | Batched event ingest + heartbeats |
| GET `/attempt/:attemptId/proctoring/session` | 👤 (scoped) | Session status / resume |
| GET `/attempt/:attemptId/proctoring/timeline` | 👤 (scoped) | Review timeline |
| POST `/attempt/:attemptId/proctoring/review` | 🔧 | Confirm/dismiss/escalate + note |
| GET/POST/DELETE `/proctoring-overrides` | 🔧 | Accommodation overrides |
| GET `/proctoring-metrics/digest` | 🔧 | Nine-dimension monitoring digest |

### `/api/public` — public quizzes & leads (live, 🔓)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/share/:shareToken` | 🔓 | Legacy 302 → web app |
| GET `/quiz/:shareToken` | 🔓 | Quiz metadata for landing page |
| POST `/quiz/:shareToken/lead/send-otp` | 🔓 | Email OTP to the lead |
| POST `/quiz/:shareToken/lead/verify-otp` | 🔓 | Verify → lead saved + 4-h guest token |
| POST `/quiz/:shareToken/start` | ⚪ | Start/resume guest attempt |
| POST `/quiz/:shareToken/save-progress` | ⚪ | Autosave (merge for section-locked) |
| POST `/quiz/:shareToken/sections/:sectionIndex/submit` | ⚪ | Submit one section |
| POST `/quiz/:shareToken/submit` | ⚪ | Submit whole attempt (store-then-grade) |
| GET `/quiz/:shareToken/attempt/:attemptId/result` | 🎭 | Result (solutions gated by `shareSolution`) |

### `/api/question-bank` + `/api/subjects` (live)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/api/question-bank` | 👤 | Filter/search (students: answers stripped) |
| POST/PUT/DELETE `/api/question-bank...` | 🔧 | Create / update / soft-delete |
| GET `/api/question-bank/stats`, `/stats/summary`, `/by-subjects`, `/import-template` | 👤/🔧 | Counts, picker, template |
| POST `/api/question-bank/bulk-import` (+ `-base64`) | 🔧 | Excel/CSV import |
| GET `/api/subjects`, `/list`, `/:id` | 👤 | Subjects by year / flat / one |
| POST/PUT/DELETE `/api/subjects...` | 🔧 | Manage subjects (soft delete) |

### `/api/daily-pyq` (live)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/today` | 👤 | Today's 10 questions (or graded attempt) |
| POST `/submit` | 👤 | Submit (idempotent, +4/−1, streaks) |
| GET `/history` · GET `/attempts/:attemptId` | 👤 | Own history / detail |

### `/api/mini-gt` (live)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/latest` | 🎓 | Current Mini GT + own status |
| GET `/attempts` | 🎓 | Own history |
| GET `/attempts/:attemptId/analysis` | 🎓 | Cohort analysis (trimmed for free users) |
| POST `/generate` | 🔧 | Generate a new Mini GT |

### `/api/free-user-analytics` (live)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/overview` · GET `/ids` | 🧑‍🏫🔧 | Free-user KPIs / canonical id list |
| GET `/users` · GET `/users/:id` | 🧑‍🏫🔧 | List / drilldown |
| GET `/performance` | 🧑‍🏫🔧 | Aggregates, streaks, drop-off |

### `/api/integration/v1` (live, 🤖 service token)

| Method & path | Purpose |
|---|---|
| POST `/handoff/consume` | Exchange one-time app→web code for a JWT |
| POST `/free-user/signup` | Website funnel: create free account (no OTP) |

### `/api/settings` ❄️ (allowlisted: GET `/public`, GET `/`, PUT `/proctoring-enabled`)

| Method & path | Who | Purpose |
|---|---|---|
| GET `/public` | 🔓 | `{ signUpEnabled }` probe for the login screen |
| GET `/` | 🔧 | All toggles + audit info |
| PUT `/signup-enabled` | 🔧 | Open/close public signup |
| PUT `/proctoring-enabled` | 🔧 | Proctoring kill switch |
| PUT `/proctoring-strict-cv` | 🔧 | Strict-CV gate (stays off) |

### `/api/mentor-students`, `/api/student-subjects`, `/api/assignments`, `/api/admin-overview` ❄️

| Method & path | Who | Purpose |
|---|---|---|
| GET `/api/mentor-students/mentor/:mentorId` · `/student/:studentId` | 👤 (scoped) | Mentor's students / student's mentors |
| POST `/api/mentor-students` · DELETE `/:id` | 🔧 | Replace mentor list / legacy remove |
| GET/POST/PUT `/api/student-subjects/:studentId` | 👤/🔧 | Student's subjects |
| GET `/api/assignments/student/:studentId` · `/week/:studentId` | 👤 (scoped) | Student's tasks / this week |
| GET `/api/assignments/mentor/:mentorId` (allowlisted `/students`) | 🧑‍🏫 | Mentor's tasks / roster stats |
| POST `/api/assignments` · PUT `/:id` | 🧑‍🏫 | Create / edit task |
| PUT `/:id/complete` | 🎓 | Student marks done |
| PUT `/:id/verify` | 🧑‍🏫 | Verify or send back (redo) |
| DELETE `/:id` | 🧑‍🏫🔧 | Delete task |
| GET `/api/admin-overview/students` · `/mentors` · `/mentor/:mentorId/details` | 🔧 | Admin dashboard |

### `/api/health` (live, 🔓)

| Method & path | Purpose |
|---|---|
| GET `/` · GET `/api/health` | Service health + dependency detail (always 200) |
| GET `/database` | 200/503 by DB state |
| GET `/auth` | Live JWT sign+verify roundtrip |

---

*End of guide. Generated from a full read of `backend/` on 2026-10-22 (HEAD `7c9276f`). If you're changing one specific subsystem, the fastest path is: find its router in `backend/routes/`, follow the utils it imports, and check `backend/tests/integration/` for the behavior contract.*
