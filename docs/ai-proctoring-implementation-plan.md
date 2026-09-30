# AI Proctoring & Exam Integrity System — Implementation Plan and Technical Specification

Everything below is **planning and specification only**. No application code, schema, dependency,
or configuration was modified while producing this document. It is intended to be the single
technical reference for implementing the AI proctoring system end-to-end, without the
implementing developer needing to make major architectural or product decisions.

| | |
|---|---|
| **Document type** | Implementation plan + technical specification |
| **Status** | Draft, revision 3 — decisions D1–D15 applied; ready for implementation planning against Phase 0 |
| **Prepared from** | Full inspection of the repository at commit `b885fa1` (2026-09-15) |
| **Applies to** | `backend/` (Express API), root Expo app (`app/`, `components/`, `context/`, `services/`, `utils/`), `client/` (Vite web app) |
| **Revision 3 changes** | All open decisions D1–D15 **resolved** (§33): **fullscreen REMOVED from scope**; focus/tab/app policy finalized (warn each of first 3–4 violations → final warning → auto-submit); benign-interruption grace/tolerance mechanism; attention/gaze events **record-only in V1**; screen-capture prevention enabled during active attempts only; **server-side quiz-duration gap fix included in this work** (§7.5); mentor timeline access confirmed; proctoring strictly **opt-in per quiz**; strict CV enforcement restricted behind controlled global gating; plain-English centralized consent/warning copy; measurable rollout-gate dimensions |
| **Standing exclusions** (unchanged from rev 2) | No evidence screenshots or image capture of students · no identity verification · no question randomization · no legal/compliance implementation work (§4.4) |

**Rule of thumb:** every numeric threshold, weight, interval, and angle in this document is
**illustrative and provisional** — a starting point for empirical calibration, never a
production-approved value. Sections §5 and §31 define what must be measured before any value is
enforced.

**Section markers used throughout:**

- `[CURRENT]` — fact about the codebase as it exists today (verified by inspection).
- `[PROPOSED]` — what should be built for the proctoring V1 scope.
- `[V1.1]` — improvement on proven V1 mechanics; requires validation, not new architecture.
- `[FUTURE / V2]` — designed-for extension, explicitly out of the V1 build.
- `[OUT OF SCOPE]` — will not be built in this project (includes items **REMOVED** by decision).
- `[RESOLVED Dx]` — a decision from §33 that fixed the surrounding text.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Architecture Analysis](#2-current-architecture-analysis)
3. [Existing Quiz Flow & Lifecycle](#3-existing-quiz-flow--lifecycle)
4. [Scope Definition — Master Architecture vs V1 / V1.1 / V2](#4-scope-definition--master-architecture-vs-v1--v11--v2)
5. [Mandatory CV/ML Feasibility Spike (Phase 0)](#5-mandatory-cvml-feasibility-spike-phase-0)
6. [Master Architecture — Signals → Events → Rules → Risk → Policy → Actions](#6-master-architecture--signals--events--rules--risk--policy--actions)
7. [Attempt & Session Lifecycle (incl. Server-Authoritative Duration, D12)](#7-attempt--session-lifecycle-including-server-authoritative-duration-d12)
8. [Pre-Quiz Proctoring Check](#8-pre-quiz-proctoring-check)
9. [Student Consent & Plain-English Copy (D7)](#9-student-consent--plain-english-copy-d7)
10. [Camera Monitoring & Camera Health](#10-camera-monitoring--camera-health)
11. [Face Detection, Presence & Multiple Faces](#11-face-detection-presence--multiple-faces)
12. [Terminology Ladder — Face Detection → Presence → Head Pose → Attention → Gaze](#12-terminology-ladder--face-detection--presence--head-pose--attention--gaze)
13. [Head Pose & Attention Estimation (Record-Only in V1)](#13-head-pose--attention-estimation-record-only-in-v1)
14. [Browser / OS / App Integrity Signals & Platform Limitations](#14-browser--os--app-integrity-signals--platform-limitations)
15. [Screen-Capture Prevention (Attempt-Scoped) — Fullscreen REMOVED](#15-screen-capture-prevention-attempt-scoped--fullscreen-removed)
16. [Session Health & Heartbeat](#16-session-health--heartbeat)
17. [Event Model, Episodes & Deduplication](#17-event-model-episodes--deduplication)
18. [Rules Engine & Violation Lifecycle](#18-rules-engine--violation-lifecycle)
19. [Risk Scoring — Provisional, Explainable, Calibratable](#19-risk-scoring--provisional-explainable-calibratable)
20. [Warning & Auto-Submit Behavior — Per-Event Ladders, Grace & Tolerance](#20-warning--auto-submit-behavior--per-event-ladders-grace--tolerance)
21. [Per-Quiz Proctoring Configuration](#21-per-quiz-proctoring-configuration)
22. [Proctoring State Machine](#22-proctoring-state-machine)
23. [Failure & Recovery Handling](#23-failure--recovery-handling)
24. [Server Authority, Security & Idempotency](#24-server-authority-security--idempotency)
25. [Admin & Mentor Analytics, Event Timeline, Access Model](#25-admin--mentor-analytics-event-timeline-access-model)
26. [Database Design Proposal](#26-database-design-proposal)
27. [API Design Proposal](#27-api-design-proposal)
28. [Real-Time Architecture](#28-real-time-architecture)
29. [Testing Strategy (incl. Accessibility & False-Positive Matrix)](#29-testing-strategy-incl-accessibility--false-positive-matrix)
30. [Observability](#30-observability)
31. [Rollout Strategy & Gates — Internal → Shadow → Warning → Controlled → Production](#31-rollout-strategy--gates--internal--shadow--warning--controlled--production)
32. [Implementation Phases & Acceptance Criteria](#32-implementation-phases--acceptance-criteria)
33. [Decision Log — D1–D15 RESOLVED](#33-decision-log--d1d15-resolved)
34. [Risks & Mitigations](#34-risks--mitigations)
35. [Final Recommended Architecture](#35-final-recommended-architecture)
36. [Consolidated Summary](#36-consolidated-summary)

---

## 1. Executive Summary

This document specifies a configurable, per-quiz, **opt-in** AI proctoring / exam-integrity
monitoring system for the Eyeconic mentorship platform, grounded in the existing three-part
monorepo — the Expo mobile app used by registered students, the Express/MongoDB backend on
Render, and the Vite web client — and reusing the platform's proven patterns:
server-authoritative grading and section-lock CAS finalize, the `tabSwitchCount` telemetry
channel that already flows into analytics and exports, the feature-freeze flag trio, the
`AppSettings` singleton kill-switch pattern, and the existing attempt resume/resync machinery.
**This work also fixes the pre-existing server-side quiz-duration gap for flat quizzes (§7.5,
decision D12)** because reliable proctoring depends on server-authoritative attempt timing.

### Core architectural stance

```
Signals → Events → Rules → Violations → Risk → Policy Action → Admin/Mentor Review

(AI/CV produces observations. The rules engine determines policy. The backend remains
 authoritative. The system never simply declares "AI detected cheating.")
```

Non-negotiable principles baked into every section:

1. **Signals, not verdicts.** No event, rule output, or score is ever labeled "cheating".
2. **Episodes, not frames.** Detections are debounced into interval episodes (start, end,
   duration, confidence); nothing is stored or judged per camera frame.
3. **Thresholds = duration + repetition + confidence.** Single frames and sub-second blips never
   produce violations. Blinking, glancing, head movement, and posture shifts are normal and are
   explicitly protected (§13.3, §29.4).
4. **The server is authoritative** — for attempt state, session state, policy, violation counts,
   risk, timing, and final submission. A client can never assert "risk = 90" or "violation
   happened" (§24).
5. **Deterministic ≠ probabilistic.** Focus/tab/app events are (platform-caveated) facts;
   CV observations are estimates. Attention/gaze events are **record-only in V1** and can never
   warn, violate, or submit on their own (D6, §13).
6. **Heartbeat is a health signal**, not an honesty proof (§16).
7. **Degrade, never destroy.** Technical failures (camera, network, model) follow grace →
   recovery → warning ladders before any policy consequence (§20).
8. **Focus-loss tolerance before enforcement.** Default policy warns the student on each of the
   first ~3 focus-loss violations, delivers a final warning, and only then auto-submits (D3, §20.3).
9. **No fullscreen.** The quiz stays in its normal application/browser state; focus/app/tab
   monitoring covers the equivalent integrity concern (D2, §15).
10. **A mandatory feasibility spike (Phase 0) gates all CV implementation** (D1, §5).

### Scope in one paragraph

**V1** (production foundation): full precheck + plain-English consent (no fullscreen step), face
presence/absence, single vs multiple faces, face-out-of-frame, camera health/interruption with a
conservative recovery ladder, basic head-pose-derived **attention estimation running
record-only**, app/tab/focus monitoring with the 3–4-tolerance warn→final-warn→auto-submit
ladder, benign-interruption grace/tolerance, session heartbeat, structured episode timeline,
server-side rules engine, screen-capture prevention during active attempts where supported, the
server-side duration fix, and admin + mentor timeline/analytics. **V1.1**: attention/gaze
improvements (spike-gated) and threshold/episode/risk calibration from real data — including
deciding whether attention events may ever graduate beyond record-only. **V2+**: phone and
object detection, advanced behavioral analysis. **Out of scope entirely**: evidence
screenshots/images, identity verification, question randomization, fullscreen enforcement,
legal/compliance work (§4.4).

### Surface reality from the codebase

`[CURRENT]` Registered students attempt assigned quizzes **only in the Expo mobile app**
(`app/(tabs)/quizzes/[id]/taking.tsx`); the deployed web client (`client/`) hosts only the guest
public-quiz flow and the admin console. The student deployment surface is Android (Play Store
via EAS, `deployment_guide.md`).

- **V1 target surface:** the Expo app on Android. Camera/face/head-pose monitoring via a native
  camera pipeline (detector chosen by the Phase 0 spike), app-switch detection via `AppState`
  (pattern exists in `hooks/useAppRefresh.ts`), screen-capture prevention via the
  already-installed `expo-screen-capture` scoped to active attempts (§15).
- **Browser-signal monitoring** (tab/focus on web) is specified because `visibilitychange`
  tab-switch tracking already runs today in `app/(tabs)/quizzes/[id]/taking.tsx:780` and
  `client/src/pages/public/PublicQuizTakingPage.tsx:212`; its full web rollout (guest/public or
  registered-web) is `[FUTURE / V2]` — same backend pipeline, **no fullscreen anywhere**.
- **Guest/public-quiz proctoring** is `[FUTURE / V2]` (guest identity machinery exists:
  `GuestAttempt`, `findOwnedGuestAttempt`); not built in V1.

---

## 2. Current Architecture Analysis

### 2.1 Monorepo layout

| Part | Stack | Deployed at | Notes |
|---|---|---|---|
| Root app (`app/`, `components/`, `context/`, `services/`, `utils/`, `types/`) | Expo SDK ~54.0.33, RN 0.81.5, expo-router ~6.0.23, react-native-web 0.21, TypeScript | Google Play (Android, EAS — `eas.json`, `deployment_guide.md`) | Student/admin/mentor app. Web export (`expo export --platform web`, `app.json` → `web.output: "single"`) exists as a local artifact only; **not deployed**. |
| `backend/` | Express 4, Mongoose 7, Socket.IO 4, JWT (no sessions), CommonJS | Render web service `eyeconic-app-prod-1r8o.onrender.com` (dashboard-managed; `render.yaml` deliberately does not declare it) | Single instance today (rate-limit middleware comments note the single-process caveat). Production data lives in the Atlas database literally named `test` (`MONGODB_URI` carries no `dbName`). |
| `client/` | Vite 7, React 19, react-router-dom 7, Tailwind 4, axios, socket.io-client | Render static site `eyeconic-public-web` (`render.yaml`) + Vercel `eyeconicmentors.vercel.app` | Public guest quiz flow (`/public-quiz/:token/*`) + authenticated admin console. **No ML/CV libraries present.** |

### 2.2 Backend architecture `[CURRENT]`

- **Bootstrap** (`backend/server.js`): dotenv → express app + http server + Socket.IO (single `/`
  namespace, CORS from `backend/config/cors.js`) → `app.set('io', io)` → `trust proxy 1` →
  `socketHelpers.setIo(io)` → env validation → CORS → `requestId` middleware → JSON/urlencoded
  body parsers (50 MB) → inline malformed-JSON 400 → inline structured request logging
  (`requestId, method, path, statusCode, durationMs`) → `/health` + `/api/health` → route mounting
  → 404 handler → global `errorHandler`. Server exports `{ app, server }`; tests never boot it
  (they use `buildApp()` from `backend/tests/helpers/testApp.js`).
- **Route mounting with the feature-freeze gate** (`backend/server.js:211-227`): gated routers run
  `auth` **before** `featureGate(...)` so expired sessions get 401 instead of 503. `/api/quizzes`,
  `/api/question-bank`, `/api/subjects`, `/api/public` are fully live.
- **Middleware inventory** (`backend/middleware/`):
  - `auth.js` — `auth` (JWT `Authorization: Bearer` or `?token=` for CSV downloads; **rejects guest
    tokens**; loads the full `User` doc into `req.user` on every request) and
    `authorize(...roles)` (403 `Insufficient permissions.`).
  - `guestAuth.js` — `guestAuth` / `optionalGuestAuth` / `signGuestToken`; guest JWT payload
    `{ kind: 'guest', guestId }`, default 4 h, header-only; loads `req.guest`.
  - `featureGate.js` — feature-freeze 503 `{code:'FEATURE_DISABLED'}` + quiz-workflow allowlist.
  - `errorHandler.js` — final 4-arg handler; response shape `{ message, code, requestId }`;
    never leaks stacks/raw DB errors; multer error mapping.
  - `guestOtpRateLimit.js`, `otpRateLimit.js` — custom in-memory limiter pattern (3 sends/10 min,
    60 s cooldown, 5 verify failures/15 min; guests add 10/IP/10 min) → 429 `{code:'RATE_LIMITED'}`.
    **This is the template to copy for a proctoring event rate limiter.**
  - `requestId.js` — propagates/generates `X-Request-Id`, sets `req.requestId`.
  - `requireDatabase.js` — 503 `DATABASE_UNAVAILABLE` when Mongo isn't connected.
- **No helmet, no express-rate-limit, no winston/morgan** — logging is `backend/utils/logger.js`
  (structured console JSON, redacts `password/token/authorization/jwt/secret/apikey`-ish keys).
- **Error/status conventions:** 400 validation/state (often with `errorCode` in quiz routes:
  `ATTEMPT_NOT_FOUND`, `SECTION_LOCKED`, `INVALID_ATTEMPT_STATUS`, `SUBMIT_IN_PROGRESS`, ...),
  401 auth, 403 authorization/quiz-window/assignment, 404, 409 duplicate, 410 `SHARE_LINK_EXPIRED`,
  429 rate limit, 503 `FEATURE_DISABLED`/email/DB. Quiz routes return bare payloads; the
  proctoring API should follow the **public-route shape** (`{success, message, code, requestId}`)
  since it is a new, safety-relevant surface.

### 2.3 Authentication & authorization `[CURRENT]`

- Roles enum (exact): `['admin', 'mentor', 'student']` (`backend/models/User.js`), default `student`.
- User JWT: `{ userId, role }`, 7-day expiry (`backend/routes/auth.js`). Signup is toggle-gated by
  `AppSettings.signUpEnabled` (default **off**, fails closed — `backend/utils/appSettings.js`).
- Attempt ownership is enforced by embedding the owner in every query, e.g.
  `QuizAttempt.findOne({ _id: attemptId, student: req.user._id })`; analytics access via
  `assertStudentPerformanceAccess` (student=self, mentor=active `MentorStudentAssignment`, admin=any)
  — **the access model mentors already use for quiz results, reused for proctoring timelines
  (D14, §25)**.

### 2.4 Quiz configuration & settings architecture `[CURRENT]`

- **Per-quiz behavior toggles live on the `Quiz` doc** (`backend/models/Quiz.js`):
  `shareSolution`, `lockSectionsAfterSubmission` (missing field treated as ON —
  `quiz.lockSectionsAfterSubmission !== false`), `sections[]`, `isPublic`, `publicExpiryDate`,
  marking scheme, `scheduledDate`/`expiryDate`. **This is the precedent a `proctoring` config
  subdoc follows — but with an explicit `default: false` (D15), never the missing-means-on trap.**
- **Global switches live in the `AppSettings` singleton** (`backend/models/AppSettings.js` +
  `backend/routes/settings.js`): atomic upsert accessor, fail-closed reads, admin-only writes,
  `updatedBy` audit field. **Precedent for both the proctoring kill switch and the restricted
  strict-CV gate (D8).**
- **Feature flags are mirrored in three files** — `backend/config/featureAvailability.js`,
  root `utils/featureAvailability.ts`, `client/src/config/features.ts` — enforced by
  `backend/middleware/featureGate.js` (503) and the `withFeatureGate` HOC
  (`components/withFeatureGate.tsx`). Current state: quiz-only freeze (`quizzes: true`).

### 2.5 Real-time infrastructure `[CURRENT]`

Socket.IO, single namespace. Rooms: `leaderboard:<quizId>` (join requires a registered socket plus
a server-side admin/mentor role check, else `leaderboard_error`) and group chat rooms. The live
leaderboard uses a **"nudge, not payload"** pattern — `finalizeQuizAttempt` emits
`quiz_leaderboard_updated` and viewers refetch. Helpers `emitToUser` / `emitToAdmins` in
`backend/utils/socket-helpers.js`.

### 2.6 Analytics & reporting architecture `[CURRENT]`

- **`computeTestAnalytics` in `backend/utils/analytics.js` is the declared single source of
  truth** for test-level aggregates; CSV and Excel exports funnel through `collectTestReportData`
  (`backend/utils/testReportData.js`) so app/CSV/Excel are data-identical. Excel via exceljs
  (`backend/utils/testReportExcel.js`).
- Cohort scoping: `buildTestAttemptScope(user, quiz)` mentors-to-their-students.
- `tabSwitchCount` **already surfaces** in `rankStudentAttempts` rows, the per-student CSV, Excel
  exports, and guest participant lists — the proctoring summary extends this pipeline.
- Admin analytics UI: `app/(tabs)/quizzes/student-analytics.tsx` with `TabSwitcher`
  (`'test' | 'student' | 'heatmap'`) and `components/analytics/test-analytics/*`; report downloads
  via `services/downloads.ts` (`?token=` query auth).

### 2.7 Camera / media assets already in the repo `[CURRENT]`

| Asset | State | Proctoring relevance |
|---|---|---|
| `expo-camera` ~17.0.10 | In `package.json`, **never imported anywhere** | Candidate for the native capture pipeline; camera permission strings already in `app.json` (`NSCameraUsageDescription`, `android.permission.CAMERA`) |
| `react-native-webrtc` | Used by `context/CallContext.tsx` for **audio-only** mesh calls (`video: false`); web hard-blocked | Proves native media plumbing works; not suited to one-way capture (STUN-only, call signaling) |
| `expo-screen-capture` ~8.0.9 | Installed; prevention call **commented out** in `app/_layout.tsx:305-316` | **Used by V1 (D13):** attempt-scoped screen-capture prevention (§15) — deterrence, not evidence |
| Cloudinary (`backend/utils/cloudinary.js`, `imageUploader.js`) | Authoritative image store (question images, profiles) | Not used by proctoring V1 — **no images are captured** (§4.4) |

### 2.8 Testing setup `[CURRENT]`

- **Backend:** Jest `--runInBand`, `backend/tests/helpers/db.js` (mongodb-memory-server) and
  `buildApp()` (mounts routers without sockets/Cloudinary/Firebase); 26+ integration suites
  (`quizAttempt`, `quizSectionLocking`, `leaderboard`, `analytics`, `testReportExcel`, ...) and
  15+ unit suites.
- **Root app:** ts-jest over `services/`, `utils/`, `components/` only (node environment).
- **Client:** no test runner; manual verification scripts instead.
- **Verification-script culture:** `backend/scripts/verify*.js` boot the real server on in-memory
  Mongo (and headless Edge via puppeteer-core for web flows). A `verifyProctoringFlow.js` belongs
  in this family (§29.6).
- **Android emulator harness** exists (AVD TestAPI35, adb UI driving + image checks).

### 2.9 Documentation conventions `[CURRENT]`

`docs/` holds `PUBLIC_WEB_DEPLOY.md`. Conventions: H1 with em-dash subtitle, italic scope note,
`---` separators, numbered `##` sections, pipe tables, backticked identifiers, ASCII diagrams in
code fences. This file follows them.

---

## 3. Existing Quiz Flow & Lifecycle

### 3.1 Registered-student attempt flow `[CURRENT]`

```
quizzes/index.tsx (list, GET /quizzes)
   └─ [id]/instructions.tsx (GET /quizzes/:id, Start confirm Alert)
        └─ QuizContext.startQuiz → POST /quizzes/:id/start            ← attempt created here
             └─ [id]/taking.tsx
                  ├─ PUT  /quizzes/:id/attempt/:attemptId/answer      (immediate + 10 s retry queue)
                  ├─ POST /quizzes/:id/attempt/:attemptId/tab-switch  (web visibilitychange only)
                  ├─ POST .../sections/:sectionIndex/submit           (section-locked mode)
                  └─ POST /quizzes/:id/attempt/:attemptId/submit      {isAutoSubmit}
                      └─ [id]/result/[attemptId].tsx → GET .../results?groupBy=section
                          └─ [id]/review/[attemptId].tsx (solutions, shareSolution-gated)
```

**`POST /:id/start`** (`backend/routes/quizzes.js`): 404 deleted/inactive quiz → 403 not in
`assignedStudents` → 403 outside `scheduledDate`–`expiryDate` window (IST-formatted messages) →
resume of `in_progress` attempt (with lazy section-expiry sync) → **one-attempt limit** (400 if a
`completed` attempt exists unless `retestApproved`) → creates `QuizAttempt` with a **frozen
section snapshot** (`buildSectionSnapshot` from `backend/utils/sectionLocking.js` writes immutable
`sectionDefinitions` + `sectionStates` so later admin edits cannot affect an in-flight attempt —
the exact pattern the proctoring policy snapshot copies).

**Answer saves:** server resolves question identity from `quiz.questions[questionIndex]`; the
client `questionId` is only a consistency check. `isCorrect` and `metadataSnapshot` are **never**
accepted from the client — written only by `finalizeQuizAttempt` at submit.

**Submission:** `finalizeQuizAttempt` grades everything server-side (`backend/utils/grading.js`),
then atomically finalizes via a CAS `findOneAndUpdate({ _id, student, status:'in_progress' })` —
double submits collapse idempotently; the winner fires socket side effects (`quiz_submitted` to
the student, `quiz_leaderboard_updated` nudge, `quiz_completed_alert` to admins/mentor).

**Timer model `[CURRENT]`:** section-locked attempts are fully server-authoritative
(`sectionStates[].endsAt` + lazy `syncExpiredSections` cascade + CAS finalize). **Flat
(non-section) quizzes have no server-side duration check for registered users** — the client
sends `isAutoSubmit` on timer expiry; guests additionally receive `serverNow` for clock-skew-safe
display. **This gap is fixed as part of this project (decision D12, spec in §7.5).**

### 3.2 Guest/public flow `[CURRENT]`

`client/src/pages/public/PublicQuizEntryPage.tsx` (lead form → email OTP → `guestToken`) →
`PublicQuizTakingPage.tsx` (`POST /public/quiz/:token/start`; autosave 3 s debounce + 15 s
heartbeat + flush on `visibilitychange`; `serverClockOffset` clock-skew correction) →
`PublicQuizResultPage.tsx`. One attempt per person (`utils/guestAttemptIdentity.js`, 409
`QUIZ_ALREADY_ATTEMPTED`). `[FUTURE / V2]` proctoring for guests reuses this identity model.

### 3.3 Attempt state machine today `[CURRENT]`

```
                 POST /start
   (no attempt) ─────────────► in_progress ──► completed        (manual submit)
                     ▲              │
                     │              └──────────► auto_submitted (timer expiry / section cascade)
                     │
   resume via GET /attempt/:id + POST /start (finds in_progress)
```

`QuizAttempt.status` enum: `['in_progress','completed','auto_submitted']`. Proctoring must **not**
add attempt statuses (§22) — it layers a parallel `ProctoringSession` state instead.

### 3.4 Existing integrity measures — inventory and gaps `[CURRENT]`

| Measure | Where | Gap for proctoring |
|---|---|---|
| Tab-switch counter + timestamp log | `POST /:id/attempt/:attemptId/tab-switch` (`backend/routes/quizzes.js:2781`); web `visibilitychange` in `app/(tabs)/quizzes/[id]/taking.tsx:780` with an `Alert` warning; public web page tracks in-page and ships `tabSwitchCount`/`tabSwitchLog` with save-progress/submit | Fires **only on web**; native app-switching is invisible (no `AppState` listener in quiz screens); guest Expo screen has no handler at all; endpoint accepts events on already-completed attempts (no status filter) and has **no rate limit** |
| Server-side grading | `backend/utils/grading.js`; client `isCorrect` never trusted | Already correct — extend the same distrust to all proctoring claims |
| Section locking | `backend/utils/sectionLocking.js` (server snapshot, `endsAt`, CAS) | Template for server-authoritative enforcement; flat quizzes uncovered → fixed by §7.5 |
| Resume/resync | `loadAttempt` on mount (`GET /quizzes/attempt/:attemptId`), guest `resyncGuestProgress` | Pattern to reuse for proctoring session resume |
| Android back interception | `BackHandler` exit-warning Alerts in both taking screens | iOS swipe-back / web nav not intercepted |
| Screen-capture prevention | Commented out globally (`app/_layout.tsx:305-316`) | Re-enabled **attempt-scoped** in V1 (D13, §15) |
| Copy/paste / context-menu blocking; question randomization; camera monitoring; fullscreen | **None exist** | Randomization `[OUT OF SCOPE]` (§4.4); fullscreen **REMOVED by D2** (§15); copy/paste deterrence is a minor optional web nicety, not a security control |

### 3.5 Lifecycle change required at `/start` `[CURRENT → PROPOSED]`

Today the attempt is created on the first `/start` call and there is no pre-attempt gate of any
kind. The proctoring lifecycle (§7) inserts precheck + consent **before** `/start` and creates
the `ProctoringSession` **inside** the same `/start` sequence as the attempt — never earlier.
Precheck and consent never create or consume an attempt.

---

## 4. Scope Definition — Master Architecture vs V1 / V1.1 / V2

The master architecture (§6) is the **long-term target shape**; it is deliberately broader than
what gets built first. Implementation is strictly tiered so that nothing unproven blocks the
production foundation.

### 4.1 V1 — Production foundation `[PROPOSED]`

**Precheck (before the attempt exists):**

- Camera permission check (with settings deep-link recovery)
- Camera availability check (device present, stream starts, frames decode)
- Exactly one face detected
- Basic face visibility (size/framing — is the face usable for monitoring)
- Basic lighting/visibility check (is detection reliable in these conditions)
- Device capability check against the **Phase-0-measured device floor** (D10; no device
  fingerprinting)
- Network/connectivity check
- The student clearly understands what is monitored (plain-English screen)
- Explicit student consent
- Clear failure/retry states for every check, with an accommodation/contact-admin exit
- **NO fullscreen requirement** `[RESOLVED D2]` — the quiz stays in its normal app/browser state

**During the quiz:**

- Face present / face missing (episodes)
- Exactly one face / multiple faces (episodes)
- Face visibility degradation (advisory, not violation)
- Face outside the usable camera frame (episodes)
- Camera interruption / failure / permission revoked / frozen or dark feed (camera health, with
  the §20.4 recovery ladder)
- Basic head-orientation / head-pose estimation
- **Attention/gaze estimation running RECORD-ONLY** `[RESOLVED D6]` — observational events in the
  timeline; no warnings, no violations, no auto-submit from attention in V1
- Tab switching / app backgrounding / focus loss where technically available (§14)
- Grace period + tolerance for benign interruptions (§20.5) `[RESOLVED D4]`
- Structured, episode-based event timeline
- Heartbeat / session health (§16)
- Server-authoritative rules/policy enforcement (§18) — including the D3 focus ladder:
  warn each of the first ~3 violations → final warning → auto-submit (§20.3)
- Student warnings (plain-English, centralized copy)
- Auto-submit after the configured repeated focus/violation threshold
- Screen-capture prevention during the active attempt, where technically supported `[RESOLVED D13]`
- Server-authoritative attempt duration for flat quizzes `[RESOLVED D12]` (§7.5)
- Admin + mentor timeline and proctoring summary in analytics `[RESOLVED D14]`

**Explicitly NOT in V1:**

evidence screenshots · stored student images · identity verification · question randomization ·
**fullscreen enforcement** · advanced object/phone detection · aggressive gaze-based auto-submit ·
perfect gaze tracking · legal/compliance implementation.

### 4.2 V1.1 — Validated improvements `[V1.1]`

- Improved attention/gaze estimation (iris/eye landmarks) — **only if** the Phase 0 spike proves
  the library reliable; still observational at first
- **The decision of whether attention events may ever graduate beyond record-only** (toward
  warn-capable) — evaluated with calibration data, behind the restricted strict-CV gate (D8)
- Better episode detection (debounce/hysteresis tuning from recorded sessions)
- Threshold calibration and risk-weight tuning from real attempt data (§19.5)
- Robustness improvements surfaced by shadow-mode data (§31 Stage 2)

V1.1 never depends on unproven capability; if gaze estimation fails the spike, V1.1 ships the
other items and gaze slips to V2 or is dropped.

### 4.3 V2 — Future capabilities `[FUTURE / V2]`

Phone detection, object detection, advanced behavioral analysis, advanced gaze/attention, guest/
public-quiz proctoring, registered-student web surface (browser focus signals on `client/`), live
invigilation nudge. The event architecture is extensible for all of these (§17.6); none block V1.

### 4.4 Explicitly OUT OF SCOPE for this project `[OUT OF SCOPE]`

1. **Evidence screenshots / image capture** — no snapshots, stills, recording, upload, URLs,
   viewer, or retention of student images. Structured events (type, timestamps, duration,
   confidence) + risk/policy information only. The DB (§26) and API (§27) contain no evidence
   entities. If ever desired, it is a new project with its own approval.
2. **Identity assurance / authentication changes** — the shared-credentials situation is an
   acknowledged **external limitation** (observations attach to the account + device session;
   admin UI says "account"). No identity verification, face matching, or auth redesign.
3. **Question randomization / question pools / option shuffling.**
4. **Legal / compliance / privacy implementation work** — no legal-review workflows, no
   compliance program, no retention subsystem. The technical consent flow (§9) stays as the
   existing product requirement.
5. **Fullscreen enforcement** `[RESOLVED D2 — REMOVED]` — no entering, maintaining, detecting,
   warning about, or auto-submitting due to fullscreen. The quiz remains in its normal
   application/browser state. Focus/app/tab monitoring covers the equivalent integrity concern.

---

## 5. Mandatory CV/ML Feasibility Spike (Phase 0)

`[RESOLVED D1]` **Do not begin full implementation until this feasibility spike validates the
selected CV approach.** The detector is chosen from measurements, not assumptions. Hard gate:
Phase 3+ of §32 depends on the spike's written report.

### 5.1 Purpose

The biggest technical unknown is whether face detection + landmarks/head pose can run acceptably
**inside this specific app** (Expo SDK 54 / RN 0.81 / Android, quiz UI active, low-end devices in
the student fleet). The spike answers that with numbers.

> **Spike status (2026-09-15):** the Phase 0 implementation exists —
> `modules/proctoring-spike` (ML Kit Tier A wrapper), `services/proctoringSpike/` engine (39 unit
> tests), and the isolated spike screen `app/(tabs)/quizzes/proctoring-spike.tsx`. Automated
> verification passed (tsc, eslint, 80/80 root tests, `:proctoring-spike:compileDebugKotlin` under
> New Architecture with ML Kit resolved). **On-device measurement runbook pending** — see
> `docs/phase-0-cv-spike-report.md` for results, the CONDITIONAL GO verdict, and the exact
> acceptance numbers still to be collected. D1 remains open until the product owner accepts that
> report.

### 5.2 Questions the spike must answer `[PROPOSED]`

**Technology & integration**

- Which face-detection technology will be used? (Candidates: ML Kit face detection via a community
  native module; MediaPipe face landmarker via a native/custom Expo module; presence-only via a
  lightweight on-device detector — ladder in §5.4.)
- Does it work reliably in the existing application architecture (Expo Router screens, existing
  `taking.tsx` layout, existing contexts)?
- Does it require native modules? Does it work with the current Expo setup, or does it need a
  **development build / EAS rebuild** (almost certainly — Expo Go is not sufficient; confirm)?
- Does it work on **real Android devices** (emulator success necessary, not sufficient)?

**Performance & devices** (these measurements also define the D10 device floor)

- Realistic analysis FPS at ~640 px input (target: sustained ≥ 2 fps while the quiz UI renders
  at full frame rate)
- CPU/memory impact (median + p95 on the device matrix); RAM/CPU of the lowest-tier devices that
  hold the budget
- Behavior on lower-end devices; thermal behavior under sustained (10+ min) load; camera FPS
  drops and throttle behavior
- Quiz UI remains usable (scroll, image questions, timer) while analyzing

**Signal quality**

- Face detection reliability across lighting/position/glasses variations
- Multiple-face detection reliability
- Face landmarks / head-pose (Euler or transform) reliability and stability
- Model temporary-failure behavior (load/init failure → recovery path)

**Deterrence feasibility (D13)**

- Does `expo-screen-capture` prevention (`usePreventScreenCapture` / flagSecure) work in the dev
  build on the device matrix, scoped to a single screen's mount/unmount, with no leak when
  navigating away mid-attempt? (Low risk — module installed — but verified, not assumed.)

### 5.3 Spike method `[PROPOSED]`

- A throwaway spike screen in a dev build (not production code): camera preview + detector +
  live readouts (fps, face count, confidence, head angles, detector errors) + log-to-file mode.
- Device matrix: at least one mid-range Android phone, one low-end Android phone, one poor-camera
  device, the TestAPI35 emulator.
- Sessions ≥ 10 minutes (thermal), scenario passes: normal seating, glasses, dim room, bright
  backlight, face partially out of frame, second person in frame, no face, camera covered.
- Written deliverable: report answering every question above with numbers, a detector
  recommendation, the fallback decision, **and the measured device floor** (D10).

### 5.4 Candidates and fallback ladder `[PROPOSED]`

| Tier | Technology (candidate) | Signals | Fallback position |
|---|---|---|---|
| A | ML Kit face detection via community native module | Face box/count, `headEulerX/Y/Z`, tracking ID, eye-open probability | **Preferred v1 if spike passes** — cheapest integration; presence + basic head pose (enough for record-only attention) |
| B | MediaPipe face landmarker via custom/native module | 478 landmarks incl. iris + head transform | Only if A fails quality AND the team accepts the native cost; unlocks V1.1 gaze |
| C | Presence-only detector | Face found / count / box | Minimum viable V1: head pose/attention deferred; everything else stands |
| D | No viable on-device CV | — | V1 ships with integrity-signal proctoring only; CV scope formally descoped by product decision |

**Fallback rule:** if the preferred tier fails its acceptance numbers, drop to the next tier —
never "tune later and hope." V1 scope flexes down rather than shipping an unusable detector.

### 5.5 Spike acceptance criteria `[PROPOSED]`

Chosen tier passes when, on the mid-range device: sustained analysis ≥ 2 fps over 10 min; bounded
memory (no leak); quiz UI responsive; face present/absent/multiple classification correct in
≥ 95 % of scenario passes; head-pose readout (Tier A/B) directionally correct in ≥ 90 % of poses;
model load ≤ 10 s p95; recovery without app restart in ≥ 4/5 induced failures; screen-capture
prevention toggles cleanly per mount/unmount. The measured **device floor** (the lowest device
class holding the FPS/CPU/memory budget) is recorded for §8.2. Numbers are spike targets
(measurable), not production thresholds.

---

## 6. Master Architecture — Signals → Events → Rules → Risk → Policy → Actions

### 6.1 End-to-end pipeline

```
Precheck → Consent → Start Attempt
   ↓
CREATE QUIZ ATTEMPT + CREATE PROCTORING SESSION + FREEZE POLICY   (one backend sequence)
   ↓
ACTIVE QUIZ
   ↓
┌───────────────────────────────┐
│ Signal Sources (client)       │   Camera / Face CV · Head Pose ·
│                               │   Attention/Gaze Estimation (record-only V1) ·
│ Camera / Face CV              │   Camera Health · App/Tab/Focus Signals ·
│ Head Pose                     │   Network / Heartbeat
│ Attention/Gaze Estimation     │
│ Camera Health                 │
│ App/Tab/Focus Signals         │
│ Network / Heartbeat           │
└───────────────┬───────────────┘
                ↓   (on-device signal processing: debounce, hysteresis,
                ↓    confidence gating — §17)
        Structured Events (episodes, categorized: technical | cv_observation | integrity)
                ↓
          Rules Engine (server, pure)
                ↓
       Violation Evaluation (deterministic policy events vs probabilistic
                ↓            CV observations — never conflated)
          Risk Scoring (server, explainable)
                ↓
        Quiz Policy Engine (per-quiz frozen snapshot)
                ↓
      ┌─────────┼─────────┐
      ↓         ↓         ↓
   Continue   Warn    Auto-submit (server-executed)
                ↓
       Admin / Mentor Event Timeline (+ review)
```

### 6.2 Layer responsibilities (who owns what)

| Layer | Owns | Must NOT do |
|---|---|---|
| Signal sources (client) | raw observations: frames→detector, OS/browser focus events, camera health, heartbeat pings | decide anything policy-related; label anything "cheating"; compute risk |
| Signal processing (client) | debounce/hysteresis episode formation, confidence gating, local buffering & retry | emit per-frame data; drop data silently on failure |
| Events (transport + storage) | idempotent batched submission; immutable categorized episode records with server timestamps | accept client risk/violation claims |
| Rules engine (server) | evaluate events against the frozen policy snapshot → violations (counted server-side) | re-detect; trust client classifications beyond validation |
| Risk scoring (server) | transparent additive score from contributions, fully explainable | act — scoring never submits anything |
| Quiz policy engine (server) | decide CONTINUE / WARN / AUTO-SUBMIT from violations + risk + policy | delegate decisions to the client |
| Actions (server) | warnings via response/socket + banner; auto-submit via the existing CAS finalize | double-count, double-submit, act without warning-first per D3 |
| Admin/mentor analytics (§25) | timeline, summary, review status | alter marks; make misconduct determinations |

### 6.3 Module map — what gets created where `[PROPOSED]`

| Layer | New modules (proposed paths) | Mirrors / extends |
|---|---|---|
| Expo app — engine | `services/proctoring/ProctoringEngine.ts`, `nativeCameraSource.ts` (expo-camera), `detectors/` (spike-chosen), `episodeTracker.ts` (debounce/hysteresis/cooldown), `eventBuffer.ts` (batching + retry queue) | `context/QuizContext.tsx` save-queue retry pattern (10 s flush, drop only on permanent 4xx) |
| Expo app — UI | `app/(tabs)/quizzes/[id]/precheck.tsx`, `components/proctoring/{ConsentScreen,PrecheckStep*,ProctoringBanner}.tsx`, `utils/proctoringCopy.ts` (D7 centralized copy) | `components/KeyboardAvoidingDialog.tsx` constraints (no input-bearing RN Modals — Android SDK 54 keyboard breakage); warnings are banners |
| Expo app — state | `context/ProctoringContext.tsx` (sibling of `QuizContext`, persisted to AsyncStorage) | `context/QuizContext.tsx` |
| Expo app — deterrence | `hooks/useAttemptScreenCapturePrevention.ts` (D13, wraps `expo-screen-capture`, mount-scoped) | — |
| Web client (V2) | `client/src/services/proctoring/` (browser engine: `getUserMedia`, visibility/blur focus signals — **no fullscreen code**) | `client/src/pages/public/PublicQuizTakingPage.tsx` autosave/heartbeat patterns, `serverClockOffset` |
| Backend — models | `backend/models/Proctoring{Session,Event,Consent,Violation}.js` | model conventions |
| Backend — logic | `backend/utils/proctoring/{rulesEngine,riskScore,eventValidation,policySnapshot,sessionHealth,durationEnforcement,proctoringAccess}.js` (all pure where possible) | purity + unit-test style of `backend/utils/analytics.js`, `sectionLocking.js` |
| Backend — transport | `backend/middleware/proctoringRateLimit.js` | `backend/middleware/guestOtpRateLimit.js` |
| Backend — routes | proctoring sub-routes on the quizzes router (§27) | route-ordering care in `quizzes.js` |
| Backend — analytics | `backend/utils/proctoring/summary.js`; extend `collectTestReportData` | single-source-of-truth rule |
| Admin UI | `'proctoring'` tab in `app/(tabs)/quizzes/student-analytics.tsx`; `components/analytics/proctoring/{ProctoringSummary,ProctoringTimeline}.tsx`; extend `AttemptDetailModal.tsx` | existing tab + DataTable/StatCardGrid patterns |
| Quiz author UI | `proctoring` section in `create-quiz.tsx` / `edit-quiz.tsx` (opt-in, D15) | existing quiz form sections |
| Flags | `aiProctoring` in the mirrored trio: `backend/config/featureAvailability.js`, `utils/featureAvailability.ts`, `client/src/config/features.ts`; kill switch + restricted strict-CV gate in `AppSettings` | §2.4 |

### 6.4 Integration points with existing code (index)

| Integration point | File | Nature |
|---|---|---|
| Attempt + session creation, policy freeze | `backend/routes/quizzes.js` `POST /:id/start` | extend — one sequence creates attempt + session (§7) |
| **Server-side duration enforcement (D12)** | same route + answer/submit handlers + `finalizeQuizAttempt` | extend — §7.5 |
| Consent gating before start | same route + `[id]/instructions.tsx` | extend — 403 `PROCTORING_CONSENT_REQUIRED` |
| Event ingestion | new sub-routes under `/api/quizzes/:id/attempt/:attemptId/proctoring/*` | new |
| Auto-submit | internal call into the existing submit/finalize path with `isAutoSubmit: true` + reason | extend — CAS already makes double-submit safe |
| Session close on finalize | `finalizeQuizAttempt` winner branch | extend — close session, freeze summary |
| Attempt resync | `GET /quizzes/attempt/:attemptId` + `loadAttempt()` | extend — return session state for engine re-arm |
| Tab-switch telemetry | `backend/routes/quizzes.js:2781` + both taking screens | supersede/absorb as focus events; dual-write during migration (§27.5) |
| Screen-capture prevention | `app/(tabs)/quizzes/[id]/taking.tsx` (+ guest/web screens later) | enable attempt-scoped (§15, D13) |
| Analytics | `computeTestAnalytics` callers + `collectTestReportData` | extend with `proctoringSummary` block |
| Warning delivery | `emitToUser` on the student's existing notification socket | reuse |
| Feature freeze | `featureGate.js` allowlist for the new sub-routes while `aiProctoring` is on | extend |
| Timer semantics | section `endsAt` cascade stays authoritative; flat-quiz deadline added (§7.5) | extend |

### 6.5 Design principles (binding for implementation)

1. Signals, not verdicts — event types describe observations; `CHEATING`/`FRAUD`/`IMPERSONATION`
   are banned identifiers anywhere in schema or UI (test-enforced, §29.2).
2. Episodes, not frames — the client emits interval episodes only; the server stores episodes only.
3. Server-authoritative actions — only the backend counts violations, computes risk, or submits.
4. Grace before punishment — technical-failure signals never auto-submit without a duration
   threshold AND recovery attempts (§20); focus violations follow the warn-first ladder (D3).
5. Policy is data — frozen onto the attempt at `/start` (like `sectionDefinitions`).
6. Deterministic vs probabilistic separation (§17.4) — CV estimates can never, alone, trigger
   aggressive actions; in V1, attention/gaze CV events cannot trigger *any* action (D6).
7. Auditability — events append-only; every action recorded with its cause.
8. Degrade, never block — if the ML stack fails, record `MODEL_UNAVAILABLE` and continue with
   integrity signals only (unless camera is strictly required, in which case precheck gated entry).
9. Quiz UI always wins resource contention (§5.2 budget).
10. Proctoring is opt-in per quiz; existing quizzes never become proctored (D15).

### 6.6 Conflicts with the existing architecture (documented, none modified)

| Conflict | Safest resolution in this plan |
|---|---|
| `POST .../tab-switch` accepts events on completed attempts, no rate limit, trusted increments | New event pipeline validates `status:'in_progress'` and rate-limits; legacy route dual-writes then retires (§27.5) |
| Flat quizzes have no server-side duration enforcement | **Fixed in this project (D12, §7.5)** — no longer a lingering gap |
| Feature-freeze mirrors must stay in sync | `aiProctoring` added to all three files in the same commit; gate test extended |
| RN Modal keyboard/edge-to-edge breakage (Android SDK 54) | All proctoring dialogs are routes or main-window overlays; quiz-time warnings are banners |
| In-memory rate limiting on a single Render instance | Acceptable at current scale (matches OTP limiters); Redis path documented if scaling happens |
| Production DB is literally named `test` | No schema changes now; implementation migrations are additive; indexes via Mongoose autoIndex |
| `lockSectionsAfterSubmission` uses a missing-means-ON default | The `proctoring` subdoc deliberately uses **explicit `default: false`** so absent config can never silently proctor (D15) |

---

## 7. Attempt & Session Lifecycle (including Server-Authoritative Duration, D12)

This section is the normative answer to every "when is X created / started / enforced" question.

### 7.1 The canonical lifecycle `[PROPOSED]`

```
Quiz Instructions (existing [id]/instructions.tsx)
        ↓  (quiz.proctoring.enabled — opt-in, default false [D15])
Pre-Proctoring Checks  ([id]/precheck.tsx — client-side checks + camera preview)
        ↓  all required checks pass            ✗ failure → retry the failed step;
        ↓                                       nothing is created or consumed
Student Consent       (consent screen → POST /:id/proctoring/consent)
        ↓  explicit consent recorded (keyed quiz+student+policyVersion)
START ATTEMPT         (the EXISTING POST /quizzes/:id/start, extended)
        ↓  single backend sequence:
        ↓    1. existing validations (assignment, window, one-attempt/resume)
        ↓    2. require consent + precheck attestation for proctored quizzes
        ↓    3. create QuizAttempt (timer starts NOW: attempt.startTime = server now;
        ↓       server-side duration deadline computed here — §7.5)
        ↓    4. create ProctoringSession (status ACTIVE) + freeze Policy Snapshot
        ↓    5. enable attempt-scoped screen-capture prevention (D13)
        ↓    6. respond {attemptId, startTime, deadline, sessionId, policyDigest}
Begin Quiz            ([id]/taking.tsx — engine starts, first event = SESSION_STARTED)
```

Hard rules:

1. **Precheck never creates a real quiz attempt** (or a session). Failed prechecks cannot consume
   the one attempt per quiz — the student may retry any number of times within the quiz window.
2. **The session belongs to the attempt** (1:1, unique index); it is created in the same backend
   sequence as the attempt, never earlier.
3. **Consent is recorded pre-start but is not attempt-bound** — keyed
   `{quiz, student, policyVersion}`, reusable across precheck retries and start-request failures.
4. **Timer start point:** `attempt.startTime` = server time at attempt creation (existing
   semantics, unchanged). **Deadline (flat quizzes): server-computed at the same moment (§7.5).**
   Section-locked attempts keep server `sectionStates[].endsAt` deadlines. Precheck and consent
   time never counts against the student.
5. **Enforcement start point:** proctoring enforcement is ACTIVE from session creation; policy
   rules effectively begin when the taking screen reports `SESSION_STARTED` (events before it are
   startup telemetry, never violations; grace windows §20 absorb startup latency).
6. **Screen-capture prevention window:** enabled in the same `/start` sequence (client-side) /
   on taking-screen mount, disabled on finalize or screen unmount (§15).

### 7.2 Failure and interruption scenarios `[PROPOSED]`

| Scenario | What happens | Why it is safe |
|---|---|---|
| Precheck fails (any step) | Step-local retry UI; nothing persisted beyond an anonymous precheck-report (§27.2) | No attempt exists; quota untouched |
| Student closes/reloads the app during precheck | Nothing of consequence exists. Re-open → instructions → precheck fresh (camera permission persists at OS level, so re-checks are fast) | No state to corrupt |
| Precheck passes, consent recorded, then `/start` fails (network/5xx) | No attempt created (or server died mid-sequence → next row). Client shows retry; consent + precheck attestation remain valid | Start is idempotent-friendly: the route already resumes an `in_progress` attempt rather than duplicating |
| Server creates the attempt but crashes before creating the session | Attempt exists (`in_progress`), session missing. **Self-healing:** `ensureSession(attempt)` runs at `/start` resume, first event batch, and `GET /attempt/:id` resync (create-if-missing, unique `{attempt}` index, current policy snapshot) | A missing session never blocks the quiz |
| App crashes immediately after `/start` | Attempt + session exist; timer + server deadline run; no heartbeat yet. On relaunch: quiz list → start (resume returns same attemptId) → session resync → engine re-arms | Same crash-resume behavior as today `[CURRENT]`; heartbeat startup grace (§16.3) prevents a spurious gap violation |
| Student backgrounds the app during precheck/consent | Irrelevant — no monitoring exists yet; only the quiz window constrains them | Enforcement starts with the session |

### 7.3 Idempotency requirements (normative) `[PROPOSED]`

| Operation | Idempotency mechanism |
|---|---|
| `POST /:id/start` (duplicate/retry) | Existing behavior: an `in_progress` attempt is returned (resume), never duplicated `[CURRENT]`; one-completed-attempt rule blocks post-completion duplicates. Session rides the same semantics via `ensureSession` |
| Duplicate consent POST | Upsert keyed `{quiz, student, policyVersion}`; replays return the existing record |
| Event batch retry | Per-item `idempotencyKey` (client UUID); unique index `(session, idempotencyKey)`; replays return `duplicate:true`, never re-count |
| Heartbeat duplicates | State-setting, not incrementing (stores `lastSeenAt`); duplicates are no-ops |
| Auto-submit | Existing CAS finalize (`{_id, status:'in_progress'}` guard) — concurrent manual + auto submits converge to exactly one winner `[CURRENT]` |
| Out-of-order events | Stored by `serverAt`; rules engine evaluates the ordered log; late arrivals insert in order and re-evaluate idempotently (violation counters are replay-derived, §18.5) |
| Duplicate violations | Derived records keyed `(session, ruleId, episodeEventId)` — replay cannot double-count |

### 7.4 Authoritative backend state transitions (server-only) `[PROPOSED]`

```
(absent)          → ACTIVE            on /start success (ensureSession)
ACTIVE            → ACTIVE            on resume/resync (no-op; telemetry recorded)
ACTIVE            → DEGRADED          on session-health rules (heartbeat timeout, camera-loss
                                      ladder) — server-computed flag, never a client claim
DEGRADED          → ACTIVE            on recovery (heartbeat resumes, camera re-acquired)
ACTIVE | DEGRADED → CLOSED            on attempt finalize (manual, timer/deadline, auto-submit)
ACTIVE            → CLOSED_FAILED     only if the attempt is administratively voided (rare; audit)
```

Every transition carries a reason and is persisted in the session's `transitions[]` audit array.
Clients observe state; they never assert it.

### 7.5 Server-authoritative attempt duration — the D12 fix `[RESOLVED D12]`

**Current behavior `[CURRENT]`:** section-locked attempts are fully enforced server-side
(`sectionStates[].endsAt` + lazy `syncExpiredSections` cascade + CAS finalize). **Flat
(non-section) quizzes have NO server-side duration check for registered users** — the client
countdown expires, the client posts `submit {isAutoSubmit:true}`, and the server trusts the
attempt is still within time. A modified client could submit 40 minutes into a 20-minute quiz and
receive `status:'completed'`.

**Required correction `[PROPOSED]`** — one source of truth for attempt timing:

- **Deadline computation (server, at `/start`):** for flat attempts,
  `deadline = attempt.startTime + quiz.duration × 60 000 ms` (+ a small network-grace
  `durationGraceMs`, illustrative 30 s). For section-locked attempts, the existing
  `sectionStates[].endsAt` cascade remains the authority (unchanged). The deadline is stored on
  the attempt (`durationDeadline`) and returned to clients (with `serverNow`) so countdowns are
  display-only — exactly the `serverClockOffset` discipline the public flow already uses
  `[CURRENT]`.
- **Enforcement points (lazy, mirroring `syncExpiredSections`):** every attempt-touching request
  (answer save, submit, section ops, proctoring event batch, `GET /attempt/:id`) first checks the
  deadline for `in_progress` flat attempts; if passed, the attempt is finalized as
  `auto_submitted` (reason `duration.deadline`) before the request is processed.
- **Late manual submit:** a manual `submit` arriving after `deadline + grace` finalizes as
  `auto_submitted` (not `completed`) — the student's status reflects reality; results and
  analytics are unaffected functionally (analytics already include `auto_submitted` in completed
  cohorts `[CURRENT]`).
- **Interaction with proctoring session timing:** the session's close hook rides the same
  finalize CAS, so a duration-driven finalize closes the session identically to any other
  finalize; heartbeats/events arriving after finalize are rejected `SESSION_NOT_ACTIVE` and
  recorded as post-close telemetry (dropped from violation evaluation, kept for audit).
- **Interaction with proctoring auto-submit:** identical authority path — proctoring
  auto-submit and duration auto-submit both execute through `finalizeQuizAttempt` with
  `isAutoSubmit: true` + a machine-readable `autoSubmitReason` (`{kind:'duration'}` vs
  `{kind:'policy', ruleId, eventIds}`). CAS guarantees exactly one winner when both race.
- **Authoritative backend behavior:** the client `isAutoSubmit` flag becomes a *hint* about who
  initiated the request, never the determinant of status — status derives from server time vs.
  the server deadline (flat) or server `endsAt` (section-locked).

**Tests proving client-side timing cannot bypass the limit (normative, §29.2):**

1. Submit 10 min past deadline without any client timer → server finalizes `auto_submitted`.
2. Client clock skewed ±30 min → no effect (server time only).
3. Answer saves after deadline → attempt already finalized; saves rejected like any completed
   attempt (`[CURRENT]` behavior for completed attempts).
4. Manual submit 1 s after `deadline + grace` → `auto_submitted`; inside grace → `completed`.
5. Section-locked attempts → `endsAt` cascade remains the sole authority (regression suite).
6. Concurrent duration-finalize vs. manual submit → exactly one winner (CAS).
7. Resume (`GET /attempt/:id`) long after deadline → returns finalized state + attemptFinalized
   flag, mirroring today's section-lock resync behavior.

---

## 8. Pre-Quiz Proctoring Check

### 8.1 Position and UX `[PROPOSED]`

A mandatory gate between instructions and attempt creation (§7.1). Each check is a self-contained
card with live status (spinner / ✓ / ✗), plain-language explanation, a **Fix it** action where
possible, and a retry. No step may silently pass. The camera preview is **student-visible**
throughout. **There is no fullscreen step** `[RESOLVED D2]` — nothing in precheck or the quiz
requires or requests fullscreen.

### 8.2 Step 1 — Device capability (against the Phase-0 device floor, D10)

| Check | Pass condition | Failure handling |
|---|---|---|
| Platform support | App on Android (V1). Web surfaces: browser matrix `[see §33, D2-residual]` | Hard fail with supported-environments message |
| Camera API availability | expo-camera device enum returns a camera (web: `getUserMedia` exists) | Hard fail `CAMERA_UNSUPPORTED` |
| **Device floor** `[RESOLVED D10]` | Device class ≥ the floor **measured in Phase 0** (the lowest tier that held the FPS/CPU/memory budget on the spike matrix) | Hard fail with a clear message: "This device cannot run the monitoring this quiz requires" + accommodation/contact-admin path. **A device below the floor must NOT start a proctored attempt** — monitoring that cannot operate reliably must not pretend to |
| Storage headroom for models | ~50 MB free | Warn + allow continue |
| Battery advisory | Low battery | Advisory banner only |

**Deliberately excluded:** device fingerprinting, hardware IDs, injected detection scripts.
**Removed:** the fullscreen-API capability row `[RESOLVED D2]`.

### 8.3 Step 2 — Camera permission

- **Native:** `Camera.requestCameraPermissionsAsync()`; on `canAskAgain: false` (permanently
  denied) offer a Settings deep-link — the exact pattern in `utils/microphonePermission.ts`.
- **Web:** `getUserMedia({video})` prompts; `NotAllowedError` → per-browser instructions + Retry.
- **Denied:** soft block while `camera: required` (default); if `camera: optional` per quiz
  config, record the condition on the session (video monitoring absent) and proceed.
- **Busy/unavailable (`NotReadableError` / device in use):** actionable message + retry cap →
  `CAMERA_UNAVAILABLE` hard fail.
- **Readiness verification:** live preview produces N consecutive decodable frames
  (illustrative: 5 frames over ~2 s) before pass.

### 8.4 Step 3 — Face detection & framing (uses the SAME detector as the quiz)

| Condition | Behavior |
|---|---|
| Exactly 1 face, sufficient size/brightness | Pass; record baseline metrics (face box, nominal head pose, inter-ocular distance) on the session for in-quiz comparison |
| 0 faces | Guidance + framing oval overlay on the preview; retry |
| 2+ faces | "Make sure you are the only person visible" — a precheck **block**, not a violation (this is before the exam) |
| Face too far/small | Guidance; pass only at reasonable size |
| Face partially cut off | "Move into the frame" |
| Detector persistently low-confidence | Treated as a lighting/quality problem → Step 5 messaging |

### 8.5 Step 4 — Network / connectivity

- `GET /api/health` (unauth, cheap) + one authenticated lightweight call — proves reachability
  and auth before the timer would start.
- Instability heuristic (illustrative): 3 pings over ~5 s, all respond, median latency < ~2 s.
- Unstable → **warn and allow proceed** ("the quiz autosaves and resumes; monitoring events may
  be delayed"). Result recorded on the consent/session for review context.

### 8.6 Step 5 — Lighting / visibility

Practical and deliberately **lenient** — the bar is "detection works reliably", not "studio
lighting" (values illustrative, calibrated per §19.5):

| Signal | Check | Handling |
|---|---|---|
| Too dark | Face-region mean luma < ~40/255 sustained | "Improve lighting or face a light source" |
| Washed out | Luma > ~230/255 or confidence collapse with high luma | "Reduce backlight" |
| Silhouette/backlight | Face luma ≪ frame luma | Same message |
| Quality | Median detector confidence is the proxy (no separate quality model in V1) | Generic camera-quality guidance |
| Camera geometry | Extreme yaw/pitch in precheck (illustrative ±45°) | "Reposition your device" |

Anti-overreach: no skin-tone checks; no perfect-centering requirement; in-quiz monitoring
compares against **this student's recorded baseline**. A student who cannot pass after honest
attempts gets a **Request accommodation / contact admin** exit — precheck must never dead-end a
paid student.

### 8.7 Step 6 — What the student is told (monitoring explanation)

The final precheck card states, in the plain-English style of §9, what will be monitored during
this quiz (camera on, face and basic head direction checked, app/tab switching recorded,
screenshot blocking active where supported) and what can happen (warnings, then automatic
submission if switching continues). No fullscreen is requested or mentioned as a requirement.

### 8.8 Precheck reporting

An optional `POST /:id/proctoring/precheck-report` records an **anonymous-attempt-level**
aggregate (which checks ran/passed, device class, retry counts) for support analytics. It creates
no attempt, no session, no consent. The authoritative precheck proof submitted at `/start` is a
short-lived **precheck token** issued by this endpoint on success (§27.2).

---

## 9. Student Consent & Plain-English Copy (D7)

`[RESOLVED D7]` Consent is an existing product requirement for proctored quizzes and stays — as a
**technical** gate with **short, plain-English copy**, not a legal document.

### 9.1 Copy style (binding)

Short · understandable · direct · student-friendly · free of unnecessary technical terminology.
Target style (final strings centralized per §9.2, reviewed once in Phase 2):

> "This quiz uses camera-based monitoring."
>
> "Your camera is required for this quiz."
>
> "We check that your face is visible during the quiz."
>
> "Leaving the quiz app or switching windows is recorded."
>
> "Screenshots are blocked while the quiz is open (where supported)."
>
> "Please return to the quiz. Leaving the quiz repeatedly may cause your attempt to be submitted."

Never in copy: "gaze tracking", "eye tracking", "AI detects cheating", biometric/identity
language, legal-formal phrasing.

### 9.2 Copy centralization (binding)

All student-facing proctoring strings live in **one module per surface** —
`utils/proctoringCopy.ts` (Expo app) and a `proctoringCopy` section in web-client config —
keyed by copy id (`consent.title`, `consent.lines[]`, `warn.focus`, `warn.final`, ...). Warning
strings are selected server-side by warning code and rendered verbatim by the banner; the backend
stores a `consentTextVersion` with the consent record so copy changes are auditable. **Copy can
be updated later without touching core logic.**

### 9.3 Consent screen and recording `[PROPOSED]`

- Shown after technical checks pass, immediately before Start; its own scrollable screen (not an
  Android Modal). Content: the plain-English monitoring list from §8.7 (camera required · face
  visibility checked · app/tab switching recorded and may be warned about · repeated switching
  can submit your attempt · screenshots blocked where supported · events visible to your
  mentor/admins for review · no photos or video are recorded · an accommodation request path).
- Explicit acknowledge control; Start disabled until acknowledged.
- Recording: `POST /:id/proctoring/consent` persists `ProctoringConsent {quiz, student,
  consentTextVersion, policyVersion, policyHash, grantedAt, precheckSummary, surface}` **before**
  `/start`. `/start` refuses proctored quizzes without it (403 `PROCTORING_CONSENT_REQUIRED`).
- Policy version binding: consent is keyed to the policy version/hash; a quiz config change bumps
  the version and requires re-consent on the next attempt (the consent screen shows what changed).

---

## 10. Camera Monitoring & Camera Health

### 10.1 Pipeline lifecycle `[PROPOSED]`

```
IDLE → ACQUIRING (getUserMedia / expo-camera mount)
     → STREAMING (frame loop → detector → signal bus)
     → DEGRADED (model failed / low fps / thermal throttle)   ↻ back to STREAMING
     → PAUSED (attempt submitted / OS pre-empts)              → STREAMING (resume)
     → STOPPED (tracks released, camera LED off) — on every exit path, including errors
```

Rules: student-visible PiP preview with an active indicator; frames analyzed **on-device only**
(§24.4); adaptive analysis rate (illustrative 2–5 fps, lowered automatically on weak devices);
detection state is a rolling window (e.g. last 10 s) from which episodes are derived; one engine
instance per attempt, torn down on every exit path.

### 10.2 Camera-health events (technical category) `[PROPOSED]`

| Case | Detection | Event |
|---|---|---|
| Permission revoked mid-quiz | Track ends + permission re-check denied | `CAMERA_PERMISSION_REVOKED` |
| Camera disconnected / OS kill | `track.onended` / capture error callback | `CAMERA_TRACK_ENDED` |
| Lens covered / black feed | Frame luma below floor (illustrative mean < ~15/255) sustained ≥ ~5 s | `CAMERA_FEED_DARK` |
| Frozen feed | Rolling downscaled frame-hash stasis ≥ ~5 s | `CAMERA_FEED_FROZEN` |
| Camera unavailable at engine start | Acquisition failure | `CAMERA_UNAVAILABLE` |
| Detector/model failure | Load/init failure or repeated inference errors | `MODEL_UNAVAILABLE` (+ `SESSION_DEGRADED`) |

All are **technical events** (§17.2): they describe the *system's* health, not the student's
behavior. Covered vs. uncovered lenses are indistinguishable to a luma detector — that ambiguity
is exactly why these events feed review context and the conservative §20.4 ladder, never an
instant verdict.

### 10.3 Anti-jitter contract (how any condition becomes an event) `[PROPOSED]`

```
per-frame raw detections (noisy, never stored)
  → hysteresis (debounced enter/exit — illustrative ≥1.0 s each way)
  → sustained condition (duration ≥ policy minDuration for the type)
  → confidence gate (median detector confidence ≥ policy floor over the window)
  → cooldown (same condition re-opening within cooldown merges or defers — policy per type)
  → ONE episode emitted (openedAt / closedAt / duration / confidence / metadata)
```

---

## 11. Face Detection, Presence & Multiple Faces

### 11.1 Face presence events (cv_observation category) `[PROPOSED]`

| Event | Derivation (thresholds illustrative) | Notes |
|---|---|---|
| `FACE_NOT_DETECTED` | 0 faces sustained ≥ ~8 s (debounced) | Distinct from `CAMERA_FEED_DARK`: normal luma + confident detector → a face problem; ambiguous by design — review context + ladder |
| `FACE_PARTIALLY_VISIBLE` | Face box clipped / key landmarks missing ≥ ~10 s | Lower weight; posture drift is normal |
| `FACE_OUT_OF_FRAME` | Face center beyond central ROI (~80 % radius) ≥ ~10 s | Precedence vs. attention episodes (§17.5) prevents double counting; attention is record-only anyway in V1 |
| Recovery close | Each episode closes when the condition clears | Timeline shows both halves |

Micro-absences (under the floor) are **buffered and counted**: policy may convert N brief
absences in a window (illustrative: 5 × <8 s in 5 min) into one
`FACE_NOT_DETECTED {pattern:'repeated_brief'}` episode — catching rhythmic glance-at-phone
behavior without punishing a single honest second.

### 11.2 Multiple faces `[PROPOSED]`

- Rule: expected faces = 1 (policy constant, future-proofed). Sustained N ≥ 2 (illustrative
  ≥ 3 s, second face ≥ ~25 % of primary face area to count) → **one**
  `MULTIPLE_FACES_DETECTED` episode with: openedAt/closedAt, duration, peak count, median
  confidence, detector tier.
- False-positive sources (posters, mirrors, photos, TVs) are why severity starts `moderate`
  (illustrative), never `critical`, and why the consequence ceiling for this probabilistic event
  is warn + review — auto-submit only via the restricted strict-CV gate `[RESOLVED D8]`, which is
  **off throughout V1 rollout**.

### 11.3 What face detection is NOT used for `[OUT OF SCOPE]`

No identity verification / face recognition / face-match (§4.4). No emotion recognition, no
skin/complexion analysis.

---

## 12. Terminology Ladder — Face Detection → Presence → Head Pose → Attention → Gaze

The plan uses these terms exactly:

| Rung | Definition | Output | Reliability | In V1? |
|---|---|---|---|---|
| **Face detection** | "There is a face-like region in this frame" (0/1/N boxes) | boxes, count, per-frame confidence | mature, high | **Yes** (precheck + quiz) |
| **Face presence** | Episode-level derivation from detection over time | presence/absence/partial/out-of-frame episodes | high | **Yes** |
| **Head pose** | Orientation of the head: yaw/pitch/roll | angles per analysis frame, episodes when outside bands | moderate-high (ML Kit class) | **Yes — recorded; contributes review context** |
| **Attention estimation** | Probabilistic estimate "is the student generally oriented toward the screen", derived primarily from head pose | attention level + deviation episodes | moderate; a proxy, not a measurement of where the eyes look | **Yes — RECORD-ONLY** `[RESOLVED D6]` |
| **Gaze estimation** | Estimate of eye/iris pointing direction | gaze angles | low-moderate on-device; needs iris landmarks + strong calibration | **No** — V1.1 only if the spike proves it |

Binding consequences:

1. UI copy, consent, and analytics say **attention estimation** (or "attention/gaze
   estimation" where the distinction matters), never "eye tracking" or "gaze detection"
   `[RESOLVED D6/D7]`.
2. If the spike lands Tier C/D (§5.4), V1 relies on **face presence + basic head orientation**
   and says so honestly; nothing in V1's schema or UI assumes precise gaze.
3. All example angles (25°, 35°, 45°, 50°...) are **illustrative shape parameters, not
   production-approved values**. Thresholds are config (§21), calibrated empirically (§19.5).

---

## 13. Head Pose & Attention Estimation (Record-Only in V1)

### 13.1 Policy status `[RESOLVED D6 — FINAL]`

**Attention/gaze events are RECORD-ONLY in V1.** They appear in the timeline as observational
episodes like:

```
ATTENTION_CONCERN (rendered from ATTENTION_DEVIATION_SUSTAINED)
  duration: 6.1 s · confidence: 0.74 · basis: head_pose
```

They **must NOT** automatically cause, in V1: auto-submit · quiz termination · severe violations ·
warnings · any student-facing punishment. This holds regardless of quiz configuration — the V1
policy schema has **no path** to escalate attention events; graduation beyond record-only is a
V1.1+ decision gated on calibration data and the restricted strict-CV gate (D8), approved at a
rollout gate (§31). Rationale: validate estimation accuracy against real-world usage before the
signal is allowed to matter.

### 13.2 Signals (V1: head-pose tier) `[PROPOSED]`

Per analysis frame: yaw/pitch/roll from the spike-chosen detector. Derived observations
(illustrative defaults; all config):

| Observation | Illustrative trigger | Episode |
|---|---|---|
| Sustained extreme orientation | \|yaw\| or \|pitch\| > ~50° sustained > ~5 s | `HEAD_POSE_EXTREME` (record-only) |
| Repeated orient-away | ≥ 3 episodes > ~2 s within 5 min | `HEAD_POSE_REPEATED` (record-only) |
| Attention deviation (coarse) | Head oriented away from baseline beyond ~35° for > ~4 s, or ≥ 4 such episodes > ~1.5 s in 5 min | `ATTENTION_DEVIATION_SUSTAINED` / `ATTENTION_DEVIATION_REPEATED` (record-only) |

All carry `basis: 'head_pose'` + confidence in metadata (probabilistic CV observations, §17.4).

### 13.3 Normal behavior — explicitly protected (the anti-"no head movement" contract)

The following **must not** produce violations or warnings, asserted by the §29.4 matrix:

- blinking (any duration; eye-open probability dips smoothed, never events)
- looking down briefly (reading/writing posture — baseline-marked desk sector)
- small head movements and slow drift within ±~25°
- posture adjustments, shifting in the chair, stretching (brief, self-limiting)
- looking at different areas of the screen
- any single frame, however extreme; any sub-threshold glance (< ~2 s)

Detectors detect **sustained or repeated meaningful patterns**, never movement per se. The system
never requires the student to keep their head still.

### 13.4 Baseline (calibration-lite) `[RESOLVED D11]`

Precheck records the seated baseline (nominal head pose, face box, inter-ocular distance, camera
geometry class); deviation is measured against the student's own baseline. **Calibration is not a
hard blocker:** if baseline capture fails, the session proceeds with conservative global bands
(wider tolerance) and a `calibration:'fallback'` marker — **students are never punished because
calibration failed**, which in V1 is doubly safe because attention is record-only anyway.
Multi-point calibration is `[V1.1]` and only if the gaze tier lands.

### 13.5 V1.1: improved attention / (maybe) gaze `[V1.1]`

Only if the spike validated Tier B: iris-based estimation, blendshape cues, multi-point
calibration, per-tier thresholds — still observational at first; any escalation beyond
record-only is a separate decision through the D8 gate and a rollout-gate approval.

---

## 14. Browser / OS / App Integrity Signals & Platform Limitations

### 14.1 Classification — integrity signals, NOT cheating determinations

App backgrounding, tab switches, window focus loss, navigation attempts, permission dialogs,
system interruptions, and incoming calls are **browser/OS/application integrity events**
(`integrity` category). The event says: "the quiz surface stopped being the foreground/focused
context for X seconds." The **policy** decides what that means (§18). Focus loss is never
described as proof of cheating `[RESOLVED D3]`.

### 14.2 Focus-loss taxonomy `[RESOLVED D3]`

The policy distinguishes four shapes of focus loss, and they are treated differently:

| Shape | Definition (illustrative) | Treatment |
|---|---|---|
| **Accidental blip** | Hidden/backgrounded < ~2 s | Dropped by the duration floor — not counted, not warned |
| **Single focus-loss event** | One qualifying episode (≥ floor) | Recorded + counted + warned; quiz continues |
| **Repeated focus loss** | Multiple qualifying episodes within the attempt | Each counted + warned; after tolerance → final warning → auto-submit (§20.3) |
| **Prolonged absence** | One episode ≥ ~60 s | Counted + warned; duration recorded and shown to reviewers (a student gone 4 minutes is qualitatively different from 4 seconds) |

### 14.3 Signal inventory `[PROPOSED]`

| Surface | Signal source | Events |
|---|---|---|
| Web (current Expo-web + future client) | `document.visibilitychange`, `window.blur`/`focus`, `pagehide` | `TAB_HIDDEN` (duration until visible), `WINDOW_BLUR` (only when visibility stays visible — distinguishes two-monitor alt-tab) |
| Native (Expo Android — V1 surface) | `AppState` (`active → background/inactive`) — pattern exists in `hooks/useAppRefresh.ts`, currently unused in quiz screens | `APP_BACKGROUND` (duration until foreground), `APP_INACTIVE` (iOS transient) |
| Native back-out | `BackHandler` interception (exists today as an exit warning) | `EXIT_ATTEMPTED` (informational) |
| Web navigation attempt | `beforeunload` while attempt active (advisory) | `EXIT_ATTEMPTED` |

`[CURRENT]` Web already detects `visibilitychange` in both taking surfaces and posts to the
tab-switch endpoint / ships counts with save-progress — this feature **formalizes** that channel.

### 14.4 Platform limitation matrix (normative) `[PROPOSED]`

| Signal | Platform | Mechanism | Limitations | Fallback / policy behavior |
|---|---|---|---|---|
| Tab hidden | Web | `visibilitychange` | Cannot tell *what* was opened; some OS dialogs also hide the page | Duration floors + benign-cause allowance; policy decides |
| App backgrounded | Android | `AppState` background transition | Cannot tell why (home button, notification shade, incoming call, permission dialog, split-screen); some OEM battery savers kill without a background event | Duration floors; benign-grace list (§20.5); review sees duration + context |
| App "inactive" | iOS | `AppState` inactive | Transient (control center, notification pull) — very noisy | Record-only; never counted without duration |
| Window focus loss | Web | `blur` | Fires for devtools, OS dialogs, another monitor's window | Only counts when visibility stays visible and duration ≥ floor |
| Incoming call | Android | call screen backgrounds the app (same `APP_BACKGROUND`) | Indistinguishable from deliberate switching by event alone | Duration + grace; policy; review |
| System UI overlays | Android | often **no event at all** (overlay over the app) | Cannot be detected in many cases | Accepted limitation — documented, never promised |
| Page navigation (web) | Web | `beforeunload` (advisory) | Cannot reliably block | Attempt state is server-resumable; the exit itself is the signal |
| Screenshot attempt | Android | detection not reliably available; **prevention** via `expo-screen-capture` (flagSecure) is used instead (§15) | Prevention is a deterrent, not a control; iOS cannot block screenshots at all | Deterrence layer only |
| Camera permission revoked | Android | detectable on next access / track end | Timing imprecise | Camera-health ladder (§20.4) |
| Fullscreen | — | — | **REMOVED from scope** `[RESOLVED D2]` — not monitored, not required, not warned about | n/a |

**The plan promises desktop-browser-level control nowhere on Android.** Policy defaults are
chosen so undetectable situations degrade to "unmonitored interval", never to false accusations.

### 14.5 Policy modes for focus events `[RESOLVED D3]`

- **`record`** — timeline only; no warnings; no counting.
- **`warn-only`** — every qualifying episode warned; no auto-submit ever.
- **`warn-then-submit` (DEFAULT)** — the §20.3 ladder: each of the first `toleratedViolations`
  (default 3, configurable ~3–4) qualifying episodes → recorded + counted + warned + continue;
  the next one → **final warning** ("leaving again will submit your quiz"); the next → server
  auto-submit. Never a silent auto-submit.

Guardrails: accidental blips dropped by floors; benign interruptions handled by §20.5 grace;
auto-submit via existing CAS; the student sees exactly why, in plain English (§9.1).

---

## 15. Screen-Capture Prevention (Attempt-Scoped) — Fullscreen REMOVED

### 15.1 Fullscreen is removed from this project `[RESOLVED D2 — REMOVED]`

The quiz remains in its normal application/browser state at all times. There is **no** entering
fullscreen, maintaining fullscreen, detecting fullscreen exit, warning because of exit, or
auto-submitting because of exit — anywhere in precheck, the quiz, the event registry, the policy
model, or the tests. The integrity concern fullscreen used to address is covered by focus/app/tab
monitoring (§14) plus the deterrence layer below. **No code from the removed rev-2 fullscreen
design survives into implementation.**

### 15.2 Screen-capture prevention `[RESOLVED D13]`

**This is NOT evidence capture.** Nothing is recorded or stored; the purpose is solely to deter
or block the student from screenshotting/recording the quiz screen.

Lifecycle:

```
Quiz attempt starts (taking screen mounts / SESSION_STARTED)
   ↓
Enable screen-capture prevention (expo-screen-capture usePreventScreenCapture /
  preventScreenCaptureAsync — the already-installed module whose global call is
  currently commented out at app/_layout.tsx:305-316)
   ↓
Quiz is active (screen content hidden from Android recents thumbnails; screenshots blocked
  where the OS supports it)
   ↓
Attempt ends / submits / screen unmounts
   ↓
Disable/release attempt-specific prevention (allowScreenshotAgain) — no leak after the quiz
```

Design points:

- **Scoped, not global:** enabled on the taking screens' mount for proctored attempts only
  (optionally all attempts if configured — default: proctored attempts only); the rev-0 global
  prevention idea (commented out in `_layout.tsx`) is NOT revived.
- **Config:** `screenCapturePrevention.enabled` (default **true** when proctoring is on) in the
  per-quiz policy snapshot (§21.2).
- **Platform honesty:** Android `flagSecure` blocks screenshots + recents previews; **iOS cannot
  block screenshots** — the module can at most detect and notify (and even detection is
  best-effort); web has no equivalent (the V2 web surface records the limitation and relies on
  focus signals). `deterrenceApplied: 'android-flagsecure' | 'ios-detect-only' | 'unsupported'`
  is recorded on the session for reviewer context.
- **No false confidence:** this is a deterrence/security layer, not a guarantee; documented as
  such in admin docs and never presented as protection.
- Feasibility verified in the Phase 0 spike (§5.2) — clean enable/disable per mount, no leak.

### 15.3 What replaced the fullscreen precheck step

Nothing. Precheck Step 6 (§8.7) simply tells the student, in plain English, that screenshots are
blocked while the quiz is open (where supported). No capability check, no request, no
fullscreen-related failure state exists.

---

## 16. Session Health & Heartbeat

### 16.1 What heartbeat is — and is not (corrected concept)

**Heartbeat is a proctoring session health / client participation signal.** It confirms that the
client is still communicating with the server. It explicitly does **not** prove:

- that the camera is genuinely active,
- that the AI model is running correctly,
- that the client has not been modified,
- that the student is honestly being monitored.

It is therefore **one integrity signal among several**, weighed with event-stream presence,
camera-health events, and session integrity markers — never an anti-cheating guarantee, and
never described as one in code comments, UI, or docs.

### 16.2 Mechanics `[PROPOSED]`

- Client sends a heartbeat with each event batch and standalone when idle (batch piggyback is the
  primary path).
- Interval: illustrative 30 s (config `sessionHealth.heartbeatIntervalMs`); timeout: 2 ×
  interval + network grace (illustrative ~90 s total). The quiz's own autosave heartbeat
  (`save-progress` every 15 s `[CURRENT]` on web) is a secondary liveness hint.
- Server state: `lastSeenAt` on the session; `HEARTBEAT_GAP` markers computed lazily (piggybacked
  on requests — the same doctrine as `syncExpiredSections`; no always-on cron).
- Reconnect: the next contact resumes normally; the gap is recorded as a `HEARTBEAT_GAP`
  technical episode with duration.
- Degraded state: session flagged `DEGRADED` server-side (§7.4) while a gap is open; recovers on
  contact.

### 16.3 Interaction with quiz policy `[PROPOSED]`

- Default: heartbeat gaps are **record + review context only**. No warnings, no auto-submit.
- Optional strict policy (`sessionHealth.onProlongedOutage: 'warn' | 'submit'`, default
  `'record'`): requires a long sustained outage (illustrative ≥ 3 × timeout) before acting — a
  crashed phone on poor network also stops heartbeating, and that student's deadline runs
  server-side anyway (§7.5), so absence is self-limiting for timed attempts.
- Startup grace: no gap is counted before the first `SESSION_STARTED` + 2 × interval.

### 16.4 Why heartbeat still matters

It enables honest **session integrity reporting**: "events flowed normally for 58 of 60 minutes;
a 2-minute gap occurred at 10:14" — context that protects the student (network outage) as much
as it flags anomalies. A modified client that stops sending everything shows up as a gap + the
server deadline auto-submit, which is the existing behavior for any disconnected client.

---

## 17. Event Model, Episodes & Deduplication

### 17.1 Episodes, not frames (normative)

The system never stores or transmits per-frame detections.

```
BAD (forbidden):
Frame 1 → face missing · Frame 2 → face missing · ... · Frame 300 → face missing

GOOD:
FACE_NOT_DETECTED  episode
  openedAt: 10:31:12 · closedAt: 10:31:21 · duration: 9 s
  confidence: 0.91 · metadata: { detectorTier, threshold used, luma, baseline ref }
```

Episode terms (defined once, used everywhere):

- **Debounce** — a condition must persist ≥ X ms before "entered" (and ≥ Y ms absent before
  "exited"); kills single-frame noise.
- **Hysteresis** — enter/exit thresholds differ so a flickering signal doesn't spam open/close.
- **Cooldown** — after an episode closes, re-entry inside the cooldown window (illustrative 10 s)
  merges or defers per policy — prevents machine-gun duplicates.
- **Deduplication** — cross-type precedence (§17.5) + idempotency keys + episode keys (§7.3).

### 17.2 Event categories (reflected in schema and UI)

| Category | Meaning | Examples |
|---|---|---|
| `technical` | Session/camera/network/system health | `CAMERA_*`, `MODEL_UNAVAILABLE`, `HEARTBEAT_GAP`, `SESSION_*` |
| `cv_observation` | Probabilistic computer-vision observations | `FACE_*`, `MULTIPLE_FACES_DETECTED`, `HEAD_POSE_*`, `ATTENTION_*` |
| `integrity` | Browser/OS/application focus & context (platform-caveated deterministic) | `TAB_HIDDEN`, `WINDOW_BLUR`, `APP_BACKGROUND`, `APP_INACTIVE`, `EXIT_ATTEMPTED` |
| *(rules-engine output)* | **Not events** — separate `ProctoringViolation` records | see §18 |
| `system_action` | Server-generated records of actions taken | `WARNING_DELIVERED`, `AUTO_SUBMITTED`, `POLICY_ACTION_SKIPPED` |

### 17.3 Event fields `[PROPOSED]`

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | |
| `session` | ObjectId → ProctoringSession | indexed |
| `attempt` / `quiz` | ObjectId | indexed |
| `category` | `technical \| cv_observation \| integrity \| system_action` | |
| `type` | enum (§17.6 registry) | |
| `source` | `'cv' \| 'browser' \| 'os' \| 'system'` | |
| `detectorTier` | `'headpose' \| 'iris' \| null` | which spike tier produced CV events |
| `confidence` | Number 0–1 | median over the episode window; null for deterministic events |
| `openedAt` / `closedAt` | Date | episode interval; point events have closedAt = openedAt |
| `durationMs` | Number | derived, stored for queryability |
| `severity` | `info \| minor \| moderate \| major` | server-assigned per policy |
| `metadata` | Mixed | angles, counts, luma, hidden-reason, thresholds used, policySnapshotId, `basis` for attention events |
| `idempotencyKey` | String | unique per session |
| `clientSeq` | Number | transport ordering |
| `clientAt` | Date | client claim, forensics only |
| `serverAt` | Date | **authoritative** (receipt time; used for ordering/rules/timeline) |
| `actionTaken` | `{ action, ruleId, at, deliveredToStudent }` | audit of the policy result on this event |
| `review` | `{ status, reviewedBy, reviewedAt, note }` | admin review outcome (§25.4) |

### 17.4 Deterministic vs probabilistic (reliability classes)

| Class | Events | Meaning | Policy consequences |
|---|---|---|---|
| `deterministic` | `integrity` events (+ `technical` facts like permission-revoked) | The platform reported it; it happened (modulo §14.4 caveats) | Count toward violations, warn, and auto-submit per the focus ladder (D3) with duration floors |
| `probabilistic` | `cv_observation` events | A model's estimate with confidence; can be wrong | **Attention/head-pose: record-only, hard rule in V1 (D6).** Face-presence/multiple-faces: warn + review at most in V1; auto-submit only via the restricted strict-CV gate (D8), off throughout V1 rollout |

The rules engine (§18.4) enforces this structurally — a probabilistic event can never reach the
consequence level of a deterministic one in V1.

### 17.5 Cross-type dedup precedence

Co-occurring conditions count **once**, in precedence order: `technical` (camera/session problems
suppress everything downstream) > `integrity` > `MULTIPLE_FACES_DETECTED` > face-presence >
`HEAD_POSE_*`/`ATTENTION_*`. Rationale: while the camera is broken, attention estimates are
meaningless; while the app is backgrounded, CV sees nothing anyway (the engine pauses analysis).

### 17.6 Type registry (V1) `[PROPOSED]`

```
session:   SESSION_STARTED · SESSION_RESUMED · SESSION_CLOSED · SESSION_DEGRADED ·
           MODEL_UNAVAILABLE
face:      FACE_NOT_DETECTED · FACE_PARTIALLY_VISIBLE · FACE_OUT_OF_FRAME ·
           MULTIPLE_FACES_DETECTED
attention: HEAD_POSE_EXTREME · HEAD_POSE_REPEATED · ATTENTION_DEVIATION_SUSTAINED ·
           ATTENTION_DEVIATION_REPEATED     (V1: record-only, basis 'head_pose')
integrity: TAB_HIDDEN · WINDOW_BLUR · APP_BACKGROUND · APP_INACTIVE · EXIT_ATTEMPTED
camera:    CAMERA_UNAVAILABLE · CAMERA_PERMISSION_REVOKED · CAMERA_TRACK_ENDED ·
           CAMERA_FEED_DARK · CAMERA_FEED_FROZEN
system:    HEARTBEAT_GAP · WARNING_DELIVERED · AUTO_SUBMITTED · POLICY_ACTION_SKIPPED
V2 reserve: PHONE_DETECTED · OBJECT_DETECTED · SECONDARY_SCREEN_DETECTED
```

`CHEATING`, `FRAUD`, `IMPERSONATION` and synonyms are **banned identifiers** — enforced by a
unit test over the enum (§29.2). There is deliberately **no fullscreen event type**
`[RESOLVED D2]`.

Extensibility (V2): a new detector adds a registry entry, category/reliability assignment,
optional policy block, risk weight — Signal → Event → Rules → Policy is detector-agnostic by
construction. V2 features plug in without redesign, and none are built now.

### 17.7 Client clock vs server clock

Follows the platform's existing discipline (`serverNow`/`serverClockOffset` `[CURRENT]`):
sessions capture the offset at start; `clientAt` is normalized for forensics; **`serverAt`
(receipt) is the only timestamp used for rules, risk, and timeline ordering** — client clock
manipulation cannot affect decisions (§24).

---

## 18. Rules Engine & Violation Lifecycle

### 18.1 The separation (normative)

The CV/OS layer produces **observations**. It never decides anything:

```
Focus lost (integrity observation, deterministic)
        ↓ episode qualifies (duration ≥ floor, not a benign blip)
ProctoringEvent created (immutable, serverAt)
        ↓
Rules engine evaluates (pure function, server, frozen policy snapshot)
        ↓
Configured policy: counts as violation #N
        ↓
Violation count / risk updated (server, replay-derived)
        ↓
Warning delivered (per the D3 ladder) — or final warning — or server auto-submit
```

### 18.2 Full violation lifecycle

```
Detection (client, on-device, debounced)
   ↓ transport (batched, idempotent, sequenced)
Validation (server: auth, ownership, attempt status, schema, rate limits, seq, time sanity)
   ↓
Event creation (immutable ProctoringEvent, serverAt)
   ↓
Deduplication / coalescing (episode keys, idempotency, precedence §17.5)
   ↓
Severity assignment (server, per policy)
   ↓
Rules evaluation → Violation? (deterministic vs probabilistic rules §18.4)
   ↓
Risk recomputation (server, replay of the log §19)
   ↓
Policy action (CONTINUE | WARN | FINAL_WARN | AUTO_SUBMIT)
   ↓
Action delivery + audit record (actionTaken; ProctoringViolation; system_action event)
   ↓
Admin/mentor review (human; timeline + summary; §25.4)
```

### 18.3 Engine shape `[PROPOSED]`

Pure functions in `backend/utils/proctoring/` (mirroring `sectionLocking.js` style — compute,
then CAS-apply), exhaustively unit-tested:

```js
// contract sketch, not implementation
evaluatePolicy({ session, events, policySnapshot, now })
  → { action: 'CONTINUE' | 'WARN' | 'FINAL_WARN' | 'SUBMIT',
      violations: [{ ruleId, eventId, reliability, counted }],
      warnMessageCode,            // → plain-English copy key (§9.2)
      riskScore, riskCategory, warnCount }

// rules are data-driven from the snapshot, e.g.:
//   focusEvents:  { mode:'record'|'warn-only'|'warn-then-submit' (default),
//                   toleratedViolations: 3 (the "3–4" knob),
//                   minDurationMs, prolongedAbsenceMs }
//   multipleFaces:{ mode:'record'|'warn', minDurationMs }     // submit only via D8 gate
//   facePresence: { minAbsentMs, briefAbsencePattern, mode:'record'|'warn' }
//   attention:    { enabled:true, mode:'record' }             // LOCKED to 'record' in V1 (D6)
//   cameraHealth: { lossWarnAfterMs, lossSubmitAfterMs, rejoinAttempts }
//   sessionHealth:{ heartbeatIntervalMs, timeoutMs, onProlongedOutage:'record' }
//   maxViolations + violationAction (cross-type counter)
```

### 18.4 Deterministic policy events vs probabilistic CV signals (normative example)

```
Deterministic:  quiz policy tolerates 3 focus-loss violations. Qualifying APP_BACKGROUND
                episodes #1–#3 are each recorded, counted, and warned. Episode #4 receives the
                FINAL warning ("leaving again will submit your quiz"). Episode #5 triggers
                server-side auto-submit. No estimation involved — the platform reported each one.

Probabilistic:  the model estimates the head was oriented away for 6 s
                (ATTENTION_DEVIATION_SUSTAINED, confidence 0.74, basis 'head_pose').
                In V1 this is RECORDED ONLY — no warning, no violation, no auto-submit,
                regardless of configuration. Multiple faces: warn + review at most;
                any CV-driven auto-submit exists only behind the restricted strict-CV gate
                (D8), which is off for all of V1 rollout.
```

### 18.5 Violation records (derived, idempotent)

Violations are stored as `ProctoringViolation` records — `{session, ruleId, eventRefs[],
reliability, countedAt, actionTaken}` — **derived by replay** of the ordered event log, keyed
`(session, ruleId, episodeEventId)` so re-evaluation (late event, replay, bug fix) can never
double-count or double-submit. Counters are never blind increments.

### 18.6 Duplicate prevention (summary; details §7.3, §24.5)

Idempotency keys · episode keys · precedence rules · monotonic client seq with server
reconciliation · replay-derived counters · CAS finalize · rate floors with quarantine (floods
accepted-but-flagged, never silently dropped).

---

## 19. Risk Scoring — Provisional, Explainable, Calibratable

### 19.1 Where scores live

Computed **server-side only**: at event ingestion (drives live actions) and at session close
(authoritative summary). Stored on `ProctoringSession` (`riskScore`, `riskCategory`,
`riskBreakdown`) as a **replayable derivation** of the immutable log — never accepted from
clients (client-sent score fields are stripped at validation).

### 19.2 Initial weight model — PROVISIONAL, NOT SCIENTIFICALLY VALIDATED `[RESOLVED D5]`

```
Multiple faces (probabilistic)              +50   (max 2 scored)
Focus-loss violation (deterministic, D3)    +30   per counted violation (max 3 scored)
Prolonged focus absence (≥ ~60 s episode)   +15   additional per prolonged episode (max +45)
Face missing (probabilistic)                +25   per started 30 s of absence (cap +75)
Camera disabled/revoked (deterministic)     +50   (once)
Camera dark/frozen sustained ≥ 60 s         +40   per episode (cap +80; review may forgive)
Heartbeat gap (technical)                   +10   per gap ≥ timeout (cap +20)
Attention/head-pose events (V1)              +0   record-only — excluded from scoring by design
Prompt recovery (condition cleared fast)     −5   (floor 0, cap −20)
```

Deliberately simple, additive, bounded — explainable and tunable. Not scientifically validated;
never presented as such. **Attention events contribute 0 in V1** (consistent with D6): they are
timeline observations for calibration, not risk inputs. V1.1 revisits after calibration.

### 19.3 Explainability requirement (normative)

An admin must be able to answer **"why did this attempt receive this score?"** from the UI alone:
`riskBreakdown` lists every contributing event (type, time, duration, confidence, points),
modifiers applied, and the review-adjusted total. The timeline (§25) is the drill-down. A score
that cannot be explained event-by-event is a defect. The score is **never** a black-box
"AI says cheating" result.

### 19.4 Categories (illustrative bands)

```
0–20 normal · 21–40 low · 41–60 moderate · 61–80 high · 81+ critical
```

Same five-band shape as the existing `scoreDistribution` buckets. Bands are **advisory
review-triage labels** — never alter scores; `critical` means "priority review", never "cheater".

### 19.5 Calibration process (normative — before aggressive enforcement)

1. Start with the transparent provisional weights (§19.2) in **shadow mode** (§31 Stage 2).
2. Collect structured event data from real attempts + supervised test sessions.
3. Measure false positives per event type (review dismissals / total events of type).
4. Tune thresholds and weights against measured FP rates.
5. Validate against realistic scenario replays (the §29.4 matrix).
6. Only then enable enforcement modes — stage by stage per §31.

Events store the threshold/policy values used at emission time, so historical sessions re-score
under new weights without re-running students.

---

## 20. Warning & Auto-Submit Behavior — Per-Event Ladders, Grace & Tolerance

Every event family follows the same normative lifecycle, with policy-configurable values:

```
Detection → Grace period → Recovery attempt → Warning → (if recovered: continue) →
            Violation → Final action
```

### 20.1 Ladder summary table (illustrative values; all config)

| Event family | Grace (illustrative) | Recovery attempt | Warning | Violation counting | Auto-submit possible? |
|---|---|---|---|---|---|
| **Focus lost (tab/app/blur)** `[D3]` | blips < ~2 s dropped by floor | n/a | every qualifying episode, plain English | deterministic — counted each time | **Yes — by the default ladder**: tolerated (default 3) warned episodes → final warning → auto-submit on the next. `record`/`warn-only` modes never submit |
| Camera lost / dark / frozen / revoked | 10 s silent | up to 3 auto re-acquires + banner | every ~30 s while unresolved | No — technical by default | Only strict cameraHealth policy, ≥ 60 s sustained + failed rejoins |
| Multiple faces | 3 s sustain | n/a | per policy (default warn) | probabilistic | Only behind D8 gate (off in V1 rollout) |
| Face missing | 8 s sustain | n/a | per policy (default warn) | probabilistic | Only behind D8 gate (off in V1 rollout) |
| Attention/head-pose `[D6]` | 4 s sustain / repetition window | n/a | **none in V1** | **none in V1** | **never in V1** — record-only |
| Heartbeat gap | startup grace + 1 timeout | automatic on reconnect | optional strict | technical | Only strict policy, ≥ 3 × timeout sustained |
| Max violations crossed (any mix) | — | — | final warning with reason | cross-type counter | per `violationAction` |

### 20.2 Warning delivery `[PROPOSED]`

Warnings ride the event-batch response (primary) and `emitToUser` on the student's existing
notification socket (`context/NotificationContext.tsx` `[CURRENT]`) for instant banner delivery
(deduped by warnId). Banner UI, not `Alert` inside Modals. Offline students get the warning on
the next successful batch (queued server-side). Every warning is a `WARNING_DELIVERED`
system_action event. All copy comes from the centralized copy module (§9.2) — e.g.
`warn.focus`: "Please return to the quiz. Leaving the quiz repeatedly may cause your attempt to
be submitted."

### 20.3 The focus-loss ladder (normative, D3)

```
Focus lost (qualifying episode: ≥ duration floor, not a benign blip)
   ↓
Record integrity event (episode, duration)
   ↓
Increment violation count (server)
   ↓
Warn student (plain English: "Please return to the quiz…")
   ↓
Within allowed tolerance (default 3, configurable ~3–4)?  → continue quiz
   ↓ tolerance exceeded
NEXT qualifying episode → FINAL warning ("Leaving the quiz again will submit your attempt")
   ↓
Next qualifying episode after that → server-side AUTO-SUBMIT
   (existing CAS finalize; autoSubmitReason {kind:'policy', ruleId:'focus.maxViolations'};
    student sees exactly why; appeal via existing retest flow)
```

Rules: never a silent auto-submit; every step visible to the student; every step recorded on the
timeline; prolonged absence (≥ ~60 s) counts the same violation but adds the §19.2 modifier and
duration context for reviewers.

### 20.4 Camera ladder detail (the anti-accident contract)

```
camera issue detected
  → event recorded (always)
  → 0–10 s: silent grace (transient glitches)
  → 10 s: banner "Camera problem detected — check your camera. Your test continues;
      this has been recorded." + up to 3 auto re-acquires (backoff)
  → recovered: condition closes; full episode visible in timeline
  → not recovered + camera required + default policy: warn every ~30 s, continue,
      session flagged for review
  → not recovered + strict cameraHealth policy: server auto-submit ONLY after ≥ ~60 s
      sustained AND failed rejoin attempts
  → camera optional: continue unmonitored; summary states the unmonitored interval
```

Covering the lens *is* a cheating tactic — and also exactly what a failing camera looks like.
Short losses are recorded and reviewed; only long, unrecoverable losses under an explicit strict
policy can terminate, with visible warnings the whole way.

### 20.5 Benign-interruption grace & tolerance `[RESOLVED D4]`

Not every interruption is a student choice — incoming calls, permission dialogs, OS dialogs,
system popups, and temporary app interruptions are platform-controlled. Mechanism:

```
Detect interruption (focus/visibility episode opens)
   ↓
Apply grace period (configurable; illustrative 2 s floor)
   ↓
Determine whether the interruption is brief/benign
   (duration under floor → blip; where detectable, a known-benign signature)
   ↓
Recovered within tolerance → recover normally: NO event counted, at most an
   'info' record on the timeline
   ↓
Prolonged (≥ floor) or repeated beyond tolerance → record + count + apply the §20.3 ladder
```

Configurable knobs (policy snapshot, illustrative defaults): `graceMs` (~2 s) · `debounceMs`
(~1 s) · `tolerance` (repeated benign-length interruptions within a window, illustrative 5 in
5 min, before they stop being treated as benign) · recovery behavior (automatic on focus return)
· counting behavior (only qualifying episodes count). **Never assume an interruption means
cheating** — the ambiguity resolves toward the student at short durations, and toward review
(not verdicts) at long ones.

### 20.6 Auto-submit execution `[PROPOSED]`

Policy `SUBMIT` runs through the **existing** submission path (`isAutoSubmit: true`) + persisted
`autoSubmitReason` + an `AUTO_SUBMITTED` system_action event. CAS makes racing manual/auto
submits converge to exactly one winner `[CURRENT]`. The student sees exactly what happened
(plain English) and the appeal path (§23.2 / existing retest flow).

---

## 21. Per-Quiz Proctoring Configuration

### 21.1 Storage architecture

Editable config on the `Quiz` doc (`proctoring` subdoc, like `sections`/`shareSolution`); the
**effective policy is frozen onto the attempt at `/start`** (`attempt.proctoringSnapshot` +
session reference, mirroring `sectionDefinitions`) — in-flight attempts never move goalposts.

### 21.2 Config surface (V1) `[PROPOSED]`

| Setting | Values | Default |
|---|---|---|
| `enabled` | bool | **`false` — OPT-IN** `[RESOLVED D15]`. Explicit `default: false`; absent subdoc = disabled; existing quizzes never become proctored by the feature's deployment |
| `camera` | `'required' \| 'optional'` | `'required'` |
| `focusEvents` (tab/app/blur) | `{ mode: 'record'\|'warn-only'\|'warn-then-submit', toleratedViolations, minDurationMs, prolongedAbsenceMs }` | `'warn-then-submit'`, tolerated **3**, floor ~2 s, prolonged ~60 s |
| `multipleFaces` | `{ mode: 'record'\|'warn', minDurationMs }` | `warn`, 3000 ms |
| `facePresence` | `{ mode, minAbsentMs, briefAbsencePattern }` | `warn`, 8000 ms |
| `attention` (head-pose based) | `{ enabled, mode: 'record' }` | enabled, **`mode` LOCKED to `'record'` in V1** `[RESOLVED D6]` |
| `cameraHealth` | `{ lossWarnAfterMs, lossSubmitAfterMs, rejoinAttempts }` | 10000 / 60000 / 3 |
| `sessionHealth` | `{ heartbeatIntervalMs, timeoutMs, onProlongedOutage }` | 30000 / 90000 / `record` |
| `screenCapturePrevention` | `{ enabled }` | `true` (where technically supported) `[RESOLVED D13]` |
| `maxViolations` + `violationAction` | int + `'warn'\|'submit'` | 3 / `warn` (cross-type counter) |
| `riskWeights` | map | platform defaults (§19.2 file) with caps |

**Removed relative to earlier drafts:** `fullscreen` (D2 — removed entirely), `cvStrict` as a
per-quiz toggle (D8 — see §21.3), evidence (out of scope), microphone (out of scope).

### 21.3 Restricted strict-CV enforcement `[RESOLVED D8]`

Strict computer-vision enforcement (allowing CV events to auto-submit) is **not** exposed in the
quiz-authoring UI and **not** a per-quiz toggle. It exists only as a controlled global setting in
the `AppSettings` singleton (default **off**, fail-closed accessor, admin-only, `updatedBy`
audit — the `signUpEnabled` pattern), further gated by the `aiProctoring` feature flag and the
global kill switch. It stays off for the entire V1 rollout (§31); any future enablement is a
recorded decision at a rollout gate after V1.1 calibration. The default experience is always the
safer, validated policy.

### 21.4 Versioning & consent binding

Snapshot carries `version` + `sha256`. Config change → version bump → in-flight attempts keep
their snapshot; the next attempt requires re-consent (consent binds the hash; consent screen
shows what changed).

### 21.5 Admin UX

"Proctoring" collapsible section in `create-quiz.tsx` / `edit-quiz.tsx`, **off by default with an
explicit enable switch** (D15), plain-language labels ("If the student leaves the quiz: warn 3
times, warn once more, then submit"), a preview of the exact consent screen, and validation
(extend the `quizCreateValidation` suite: `warn-then-submit` requires `toleratedViolations ≥ 1`;
no fullscreen or evidence controls exist to validate — removed).

---

## 22. Proctoring State Machine

### 22.1 Composite attempt × session model

The attempt `status` enum stays **unchanged** (`in_progress → completed | auto_submitted`
`[CURRENT]`). The proctoring session adds its own states:

```
                    ┌──────────────── PRECHECK_FAILED ──┐  (retryable terminal of a precheck run:
                    │          (retry the step)          │   no attempt exists; nothing consumed)
                    ▼                                   │
NOT_STARTED ──► PRECHECK ──► READY ──► CONSENTED ──► ACTIVE ──► SUBMITTED ──► SESSION_CLOSED
 (quiz view)    (checks)    (passed)  (consent       (attempt +   │   ▲          (finalize hook:
                                      recorded;      session      │   │           summary frozen)
                                      no attempt     created at   │   │
                                      yet)           /start)      │   │
                                            │                     │   │
                                            │ consent refused/    ▼   │
                                            │ student leaves  DEGRADED│
                                            ▼                 (camera loss /│
                                     (back to NOT_STARTED;       heartbeat gap/│
                                      consent may be kept        model failure)│
                                      per policy)                │  └─► RECOVERED ──► ACTIVE
                                                                 │
                                                                 └─ not recovered + strict policy ──►
                                                                      AUTO_SUBMIT (server-executed;
                                                                      attempt becomes auto_submitted)
```

### 22.2 State definitions and triggers `[PROPOSED]`

| State | Meaning | Entry trigger (server-authoritative) | Exit |
|---|---|---|---|
| `NOT_STARTED` | Quiz visible, proctoring not begun | student opens instructions | → PRECHECK |
| `PRECHECK` | Client checks running; **no attempt, no session** | student proceeds from instructions | → READY / PRECHECK_FAILED |
| `PRECHECK_FAILED` | A required check failed (incl. below-device-floor) | any required check fails | retry → PRECHECK; give up → NOT_STARTED |
| `READY` | All required checks passed (attestation token issued) | last check passes | → CONSENTED |
| `CONSENTED` | Consent recorded (`{quiz, student, policyVersion}`) | consent POST success | → ACTIVE via `/start`; student may leave (state persists for retry) |
| `ACTIVE` | Attempt + session exist; enforcement live; screen-capture prevention on | `/start` sequence completes | → DEGRADED / SUBMITTED |
| `DEGRADED` (flag) | Session health broken (camera ladder / heartbeat gap / model failure) — the quiz **continues** | server health rules | → ACTIVE on recovery; → AUTO_SUBMIT if strict policy + sustained |
| `RECOVERED` (transient marker) | Degradation cleared | recovery signal | → ACTIVE |
| `AUTO_SUBMIT` (action, not a resting state) | Policy executed submission (focus ladder / camera strict / duration) | rules engine `SUBMIT` or §7.5 deadline | attempt → `auto_submitted` |
| `SUBMITTED` | Attempt finalized (manual, deadline, cascade, or auto) | existing finalize CAS `[CURRENT]` | → SESSION_CLOSED |
| `SESSION_CLOSED` | Summary frozen; engine torn down; screen-capture prevention released | finalize winner branch | terminal |

`WARNING` / `FINAL_WARN` are deliberately **not** states — in-band actions inside `ACTIVE`,
recorded as `WARNING_DELIVERED` events.

### 22.3 Scenario transitions (normative) `[PROPOSED]`

| Scenario | Transition path |
|---|---|
| Camera fails mid-quiz | ACTIVE → (10 s grace) → DEGRADED + banner → re-acquires: RECOVERED → ACTIVE; sustained ≥ policy floor + strict camera policy: AUTO_SUBMIT |
| Network fails mid-quiz | no state change (client buffers; §23); HEARTBEAT_GAP episode when timeout passes → DEGRADED; on reconnect → RECOVERED → ACTIVE |
| Heartbeat disappears entirely | DEGRADED; server deadline (§7.5) keeps time running; attempt ends by deadline auto-submit or manual submit on return |
| App backgrounds | no session state change; `APP_BACKGROUND` integrity episode; §20.3 ladder |
| Multiple faces appear | CV episode; warn + review per policy; no state change |
| Student recovers from anything | condition closes → RECOVERED → ACTIVE; counted violations stay counted (review may dismiss) |
| Student exceeds focus tolerance | WARN (each) → FINAL_WARN → AUTO_SUBMIT; attempt `auto_submitted`; SESSION_CLOSED |
| Exam ends naturally | server deadline (§7.5) or client timer → existing finalize cascade → SUBMITTED → SESSION_CLOSED |

---

## 23. Failure & Recovery Handling

Prime directive: **transient technical problems must not destroy a student's attempt**, and quiz
state must never corrupt. All resilience copies patterns that already work here.

| Scenario | Detection | Handling | Guarantee |
|---|---|---|---|
| Camera denied/revoked/disconnected/black/frozen mid-quiz | §10.2 heuristics | §20.4 ladder: record → grace → warn + re-acquire → policy (submit only after sustained loss + failed rejoins) | attempt continues; review sees the episode |
| Face disappears (honest: walked away) | detector | episode after floor; warn per policy; never auto-submits in V1 (probabilistic) | continues |
| Multiple faces | detector | episode + warn + review | no instant verdict |
| Poor lighting mid-quiz | confidence collapse | advisory banner ("lighting too low to monitor reliably") + degradation marker; **no violation** | attempt continues |
| Model fails mid-quiz | inference errors | fallback: pause CV signals, keep integrity signals; try reload once; record | degraded-but-honest session |
| Tab switched / app backgrounded (deliberate) | §14 signals | §20.3 ladder: warn ×tolerance → final warning → auto-submit | server-counted, never silent |
| App backgrounded briefly / by call / by OS dialog | §14 signals | §20.5 grace + tolerance: blips dropped, benign recoveries uncounted | no false violations |
| Network drops mid-quiz | fetch failures | events buffer locally (AsyncStorage, retry with backoff, drop only on permanent 4xx); quiz answers already autosave/resume `[CURRENT]` | no event loss (eventual delivery), no dupes |
| Network restored | next successful call | flush buffer in `clientSeq` order; server orders by `serverAt` | consistent timeline |
| Browser refresh / app kill / reboot | mount without engine state | `loadAttempt` + `GET .../proctoring/session` resync; engine re-arms; camera quick-path | attempt + session resume; deadline unchanged (server) |
| Crash immediately after `/start` | no heartbeat | startup grace (§16.3); resume on relaunch | no spurious violation |
| Duplicate event submission | idempotency key | 200 no-op `duplicate:true` | no double counting |
| Duplicate `/start` (retry, double-tap) | existing resume semantics + `ensureSession` unique index | same attempt + same session | no duplicates |
| Duplicate auto-submit / manual+auto race | CAS finalize | exactly one winner `[CURRENT]` | no double finalize |
| Out-of-order events | `serverAt` ordering + replay-derived counters | late events inserted by order; re-evaluation idempotent | stable counts |
| Backend timeout on batch | axios timeout | retry same batch (idempotent) | safe |
| Device thermal throttle | fps decay | lower analysis rate; quiz UI priority | usability preserved |
| Server crash mid-quiz | n/a to client | lazy enforcement doctrine (`syncExpiredSections` `[CURRENT]`): session state recomputed from events on next touch; deadline recomputed from `startTime` | deterministic replay |
| Device below the proctoring floor | precheck | hard fail with accommodation path — **cannot start a proctored attempt** `[RESOLVED D10]` | no unreliable monitoring |

Event buffer: AsyncStorage key `proctoring_event_buffer` (app) / localStorage (web), capped
(illustrative 500 events; overflow drops oldest lowest-severity with a `BUFFER_OVERFLOW` marker).

---

## 24. Server Authority, Security & Idempotency

### 24.1 What the client may submit — and what it may not (normative lists)

**Client submits (claims, always validated):** observation events `{type, openedAt/closedAt
(client claim), confidence, metadata, idempotencyKey, clientSeq}` · heartbeat pings · precheck
attestation token (server-issued, short-TTL) · consent acknowledgements · quiz answers and
submit requests (existing endpoints).

**Client never submits (server-computed, stripped/rejected on arrival):** risk scores or risk
contributions · violation determinations or counts · severity assignments · policy actions ·
authoritative timestamps (`serverAt` only) · session state transitions · attempt status (incl.
whether a submit is "within time" — §7.5 decides from server time).

### 24.2 Server-authoritative list

Attempt state · session state · policy snapshot · violation count · risk score · warnings ·
maximum-violations enforcement · **attempt duration/deadline (§7.5)** · auto-submit execution ·
final exam status. Exactly as grading works today (`isCorrect` never trusted `[CURRENT]`),
proctoring truth is computed only on the server.

### 24.3 Threat model `[PROPOSED]`

| Adversary goal | Vector | Defense |
|---|---|---|
| Fabricate a clean session | Block events; modified client | Heartbeat/event-stream absence is itself visible (`HEARTBEAT_GAP`, integrity markers) — an anomaly to review, not proof; a fully absent client still ends by the server deadline (§7.5) |
| Extend exam time | Manipulated client timer; delayed submit | Server deadline is computed at `/start` and enforced lazily on every touch; late manual submits become `auto_submitted` (§7.5 tests) |
| Frame/disrupt via fake events | Post fabricated violations | Rate limits, schema validation, episode plausibility (durations vs arrival times), flood quarantine |
| Manipulate risk | Send "riskScore": 0 | Field stripped; score is replay-derived |
| Manipulate timing | Skewed clocks | `serverAt` authoritative; offset recorded |
| Skip consent/precheck | Direct `POST /start` | Server-side preconditions (403 codes); precheck token bound to student+quiz+policyVersion |
| Replay batches | Re-send captured payloads | Idempotency keys → no-ops; monotonic seq; rate floors |
| Trigger auto-submit on another student | Cross-student posts | Ownership embedded in every query (`{_id, student: req.user._id}`); guest tokens rejected by `auth` `[CURRENT]` |
| Bypass screen-capture prevention | Rooted device, screen recording from another device | Accepted: prevention is deterrence only (§15.2) — never claimed as protection |
| Double-submit / duplicate attempts | Repeated start/submit | §7.3 idempotency + existing CAS |

### 24.4 Performance & fairness constraints on the client engine

Analysis at 2–5 fps; ≤ ~15 % sustained CPU on the mid-range device; ≤ ~250 MB additional memory;
thermal throttle → reduce analysis rate **before** reducing quiz UI responsiveness. Measured in
the spike (§5) and re-verified per release (§29.5).

### 24.5 Hardening items included in this project

- Rate-limit + status-check the legacy `POST .../tab-switch` route, or fold it into the new
  pipeline in the same release (§27.5 dual-write).
- **The §7.5 duration fix** — closing the pre-existing flat-quiz timing hole is itself a security
  hardening of the exam system.
- No new token kinds; user JWT (7 d) for students; existing middleware unchanged.
- Floods: accepted-but-quarantined (`flagged:'flood'`) for review — never silently dropped.

---

## 25. Admin & Mentor Analytics, Event Timeline, Access Model

### 25.1 Access model `[RESOLVED D14]`

Authorization is enforced by the backend using the platform's existing rules — the same model as
quiz-result visibility:

| Viewer | Access (`assertStudentPerformanceAccess` rule) |
|---|---|
| **Admin** | All attempts, all quizzes; full timeline, summary, violations, review actions |
| **Mentor** | Proctoring timelines + summaries **for their assigned students only** (active `MentorStudentAssignment`) — event type, timestamps, durations, confidence, violation counts, risk info, policy outcome. Backend-enforced; mentor-scoped analytics via `buildTestAttemptScope` |
| **Student** | Own timeline + own summary (transparency); nothing about others |

No viewer ever sees student images — none exist (§4.4).

### 25.2 Fit with the existing analytics architecture `[PROPOSED]`

The single-source-of-truth rule extends, not forks:

- `backend/utils/proctoring/summary.js` → `buildProctoringSummary(attemptIds)`: per-attempt and
  per-test rollups (counts by type/category/reliability, risk distribution, session integrity
  flags).
- `GET /api/quizzes/analytics/test/:testId` gains a `proctoring` block.
- `collectTestReportData` gains the same block → **CSV and Excel exports automatically include
  proctoring columns** (Risk Category, Total Violations, Focus-loss Exits, Multiple-Face Events,
  Face-Absent Total, Camera Incidents, Heartbeat Gaps) reusing `testReportExcel.js` conventions.
- Per-student CSV gains the same per-attempt columns (it already carries `Tab Switch Count`
  `[CURRENT]`).

### 25.3 Timeline `[PROPOSED]`

Chronological, episode-based, one row per episode (never per frame):

```
10:02:14  Test started · camera monitoring active (SESSION_STARTED)
10:05:32  Precheck baseline recorded
10:08:17  Attention observation — 6.1 s, head yaw ~41° (record-only, conf 0.74)     +0
10:12:41  Left the quiz app (APP_BACKGROUND, 14 s, integrity) — violation #1        +30
10:12:42  Warning delivered — "Please return to the quiz…"
10:14:03  Left the quiz app (APP_BACKGROUND, 9 s) — violation #2                    +30
10:14:04  Warning delivered
10:17:09  Multiple faces — 2 faces for 6 s (cv, conf 0.88) — violation #3           +50
10:17:15  Multiple-face condition cleared
10:19:02  Camera feed dark — 22 s (technical; recovered)                            +0
10:22:44  Left the quiz app — FINAL warning delivered
10:24:10  Left the quiz app — attempt submitted automatically (policy)              risk 90
10:24:11  Session closed
```

UI: `'proctoring'` tab in `app/(tabs)/quizzes/student-analytics.tsx` (beside
`'test'|'student'|'heatmap'`), per-attempt drill-in extends `AttemptDetailModal.tsx`; rows via
`components/DataTable.tsx`, KPIs via `StatCardGrid`. Students see their own timeline on the
result screen.

### 25.4 Review workflow (the human decision of record) `[PROPOSED]`

Per event or per session: **Confirm** / **Dismiss** ("sibling walked by", "camera driver
crash") / **Escalate** (institutional action outside the app). Dismissal records
`reviewedBy/At` + note and shows a `reviewAdjustedScore` **alongside** the original (originals
never overwritten). Outcomes set `integrityStatus: 'clean' | 'reviewed_ok' | 'reviewed_concern' |
'pending'`. Display only — the platform never alters marks.

**External limitation (acknowledged):** with shared student credentials `[CURRENT]`,
observations attach to the *account + device session*, not a verified person. Admin/mentor UI
labels say "account"; no identity system is built or required (§4.4).

---

## 26. Database Design Proposal

No schema is modified now. All proposed models are **new collections** (additive; indexes via
Mongoose autoIndex at startup). No evidence/image entities exist — there is no
`ProctoringEvidence` model by design (§4.4).

### 26.1 `ProctoringSession`

```
quiz / attempt / student     ObjectId refs, indexed; {attempt} unique — the 1:1 anchor
ownerKind                    'user' | 'guest' (discriminator now; guests unused in V1)
status                       'ACTIVE' | 'DEGRADED' | 'CLOSED' | 'CLOSED_FAILED' (§7.4)
policySnapshotId + policyHash + policyVersion
startedAt / endedAt
baseline                     { capturedAt, faceBox, nominalHeadPose, interOcularPx,
                              detectorTier, calibration: 'captured' | 'fallback' }
deterrence                   { screenCapturePrevention: 'android-flagsecure' |
                                'ios-detect-only' | 'unsupported' | 'disabled' }
sessionHealth                { lastSeenAt, heartbeatIntervalMs, timeoutMs, missedIntervals }
integrity                    { heartbeatsMissed, batchesRejected, floodFlagged,
                              detectorFallback, unmonitoredIntervals: [{from, to, cause}] }
riskScore / riskCategory / riskBreakdown
eventCounts                  Mixed ({type: n} denormalized for cheap summaries)
violationsCount              Number (derived; replay-consistent)
summary                      Mixed (frozen at close)
integrityStatus              'pending' | 'clean' | 'reviewed_ok' | 'reviewed_concern'
transitions                  [{ from, to, reason, at }]
timestamps: true
Indexes: {attempt:1} unique · {quiz:1, status:1} · {student:1, startedAt:-1} ·
          {quiz:1, riskCategory:1} (review queue)
```

Lifecycle per §7.4. Immutable after `CLOSED` except review fields. No soft delete; data lives
and dies with attempt data lifecycle.

### 26.2 `ProctoringEvent`

Fields exactly per §17.3.

```
Indexes: {session:1, serverAt:1} · {session:1, type:1} ·
          {session:1, idempotencyKey:1} unique · {quiz:1, type:1, serverAt:-1} · {attempt:1}
```

Append-only; only `review` and `actionTaken` subdocs are writable (audit-written).

### 26.3 `ProctoringConsent`

```
quiz / student / policyVersion     {quiz:1, student:1, policyVersion:1} unique
consentTextVersion, policyHash, grantedAt
precheckSummary                    { deviceClass, checks:[{id, pass, detail}], networkProbe }
surface                            'app-android' | 'app-ios' | 'web'
timestamps: true
```

Idempotent upsert (§7.3). Not attempt-bound. Retained for the audit horizon.

### 26.4 `ProctoringViolation` (rules-engine output, derived)

```
session / attempt / quiz           indexed
ruleId                             String (e.g. 'focus.maxViolations')
eventRefs                          [ObjectId → ProctoringEvent]
reliability                        'deterministic' | 'probabilistic'
countedAt                          Date
actionTaken                        { action, at, deliveredToStudent }
review                             { status, reviewedBy, reviewedAt, note }
Indexes: {session:1, ruleId:1, eventRefs:1} (idempotent derivation key) · {quiz:1, ruleId:1}
```

Created **only** by the rules engine server-side; replay-safe (§18.5).

### 26.5 Changes to existing collections (additive only)

| Collection | Additions |
|---|---|
| `Quiz` | `proctoring` subdoc (§21.2) — **explicit `default: false`** (D15) |
| `QuizAttempt` | `proctoringSnapshot` (frozen copy) · `durationDeadline` (§7.5) · `autoSubmitReason` Mixed · `integrityStatus` mirror |
| `AppSettings` | `proctoringEnabled` global kill switch (default **false**, fail-closed accessor) · `proctoringStrictCv` restricted gate (default **false**, D8) — both mirroring `isSignUpEnabled` |
| Admin tooling | small `ProctoringOverride` collection `{student, quiz?, reasonCode, grantedBy, expiresAt, overrides: Mixed}` (accommodations, §29.4) |

Query patterns served: timeline by session (serverAt sort); review queue by quiz+risk;
per-student history; test rollups (denormalized `eventCounts`); integrity/status joins.

---

## 27. API Design Proposal

### 27.1 Conventions

Public-route response discipline (`{success, message, code, requestId}`); existing auth stack
(`auth` + `authorize('student')` attempt-scoped; `auth` + `authorize('admin','mentor')` review
with `assertStudentPerformanceAccess` for per-student data); attempt-ownership embedded in
queries; the in-memory rate-limiter pattern; all event-ish posts idempotent.

### 27.2 Student-facing endpoints (lifecycle order)

| Endpoint | Purpose | Notes |
|---|---|---|
| `POST /api/quizzes/:id/proctoring/precheck-report` | Submit precheck results; on all-pass returns a short-TTL **precheck token** bound to `{student, quiz, policyVersion}`; stores an aggregate report (no attempt, no session) | rate-limit ~10/h/quiz; includes the device-floor verdict (D10) |
| `POST /api/quizzes/:id/proctoring/consent` | Record consent `{consentTextVersion, precheckToken}` | idempotent upsert `{quiz, student, policyVersion}` |
| `POST /api/quizzes/:id/start` (EXISTING, extended) | Creates attempt **and** session + freezes policy + computes `durationDeadline` (§7.5); validates consent + precheck token for proctored quizzes | existing validations unchanged; 403 `PROCTORING_CONSENT_REQUIRED` / `PROCTORING_PRECHECK_REQUIRED`; response adds `deadline`, `sessionId`, `policyDigest` |
| `POST /api/quizzes/:id/attempt/:attemptId/proctoring/events` | Batch ingest `{sessionId, seq, events:[{idempotencyKey, type, openedAt, closedAt, confidence, metadata}], heartbeat:true}` | response carries server-decided `{actions:[{kind:'WARN'\|'FINAL_WARN', code, message, warnId}], riskCategory}`; rate-limit illustrative 60/min + 500/session; enforces §7.5 deadline lazily first |
| `GET /api/quizzes/attempt/:attemptId/proctoring/session` | Session state for resume/resync (integrates with `loadAttempt`) | owner/admin/assigned-mentor |
| `GET /api/quizzes/:id/attempt/:attemptId/proctoring/timeline` | Student's own timeline | owner-only |

Auto-submit is **not** a new endpoint: policy `SUBMIT` executes the existing submit path
server-side; the client learns via batch response and/or `quiz_submitted` socket event
`[CURRENT]`.

### 27.3 Admin/mentor endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/quizzes/analytics/test/:testId/proctoring` | Test-level summary (§25.2), mentor-scoped via `buildTestAttemptScope` `[RESOLVED D14]` |
| `GET /api/quizzes/attempt/:attemptId/proctoring/timeline` | Full timeline — mentor: assigned students only (`assertStudentPerformanceAccess`) |
| `GET /api/quizzes/attempt/:attemptId/proctoring/summary` | Per-attempt summary + baseline + integrity + violations |
| `POST /api/quizzes/proctoring/review` | `{attemptId \| eventId, decision:'confirm'\|'dismiss'\|'escalate', note}` → review subdocs + `integrityStatus` |
| Overrides CRUD | admin-only small router for `ProctoringOverride` |

### 27.4 Error codes

`PROCTORING_DISABLED` (503, flag/kill switch) · `PROCTORING_NOT_ENABLED_FOR_QUIZ` (400) ·
`PROCTORING_CONSENT_REQUIRED` (403) · `PROCTORING_PRECHECK_REQUIRED` (403) ·
`PRECHECK_TOKEN_INVALID` (403) · `DEVICE_BELOW_FLOOR` (403, D10) · `SESSION_NOT_ACTIVE` (409) ·
`SESSION_MISMATCH` (403) · `EVENT_SEQ_REJECTED` (409, with expected seq) ·
`EVENT_FLOOD_QUARANTINED` (200 + warning) · `RATE_LIMITED` (429, existing shape).

### 27.5 Legacy tab-switch interplay

During migration the legacy `POST .../tab-switch` route keeps working (old app builds in the
field) but is wrapped: it also creates the equivalent integrity event and counts toward the same
violation counters (`source:'browser'`, `legacy:true`), and gains the missing status-filter +
rate limit. Once app builds ≥ N emit real events, the legacy route becomes a no-op returning
success.

### 27.6 Guest extension shape `[FUTURE / V2]`

Same design mirrored under `/api/public/quiz/:shareToken/proctoring/*` with
`optionalGuestAuth`/`guestAuth` and `findOwnedGuestAttempt` ownership; schema already
anticipates `ownerKind:'guest'`.

---

## 28. Real-Time Architecture

**Ordinary API requests are sufficient for V1.** Every consumer either tolerates seconds of
latency (timeline, summary) or already has a channel: warnings ride the events-batch response
(primary) plus `emitToUser` on the student's existing notification socket
(`context/NotificationContext.tsx` `[CURRENT]`) for instant banner delivery (deduped by warnId);
auto-submit rides the existing submit/socket `quiz_submitted` path. A realtime event stream
would add connections, Android battery cost, and failure modes for zero V1 requirement.

`[FUTURE / V2]`: a `proctoring_alert` nudge (no payload — the leaderboard "nudge, not payload"
doctrine `[CURRENT]`) to a future `proctoring:<quizId>` room, joined like `leaderboard:<quizId>`
with the same server-side role check, for live-invigilation refetch.

---

## 29. Testing Strategy (incl. Accessibility & False-Positive Matrix)

Mapped onto the repo's three harnesses (backend Jest + `buildApp()` + mongodb-memory-server;
root ts-jest for `services/`/`utils/`; verification-script culture) plus the Android emulator rig
and real devices from the spike matrix.

### 29.1 Unit tests (backend)

- `proctoringRules.test.js` — every policy mode × event category: the §20.3 focus ladder in all
  its permutations (blips don't count; each qualifying episode counts; FINAL_WARN fires exactly
  at tolerance+1; SUBMIT exactly at tolerance+2; `record`/`warn-only` never submit); camera
  ladder timing; benign-grace tolerance (§20.5); property tests: **no single probabilistic event
  ever yields SUBMIT under any V1-representable policy**, and **attention events never yield any
  action under any V1 policy** (D6).
- `durationEnforcement.test.js` — the §7.5 normative tests 1–7 (deadline computation, late
  manual submit → `auto_submitted`, clock-skew immunity, post-deadline answer saves, section-lock
  regression, CAS races).
- `proctoringRisk.test.js` — weight arithmetic, caps, decay, dedup precedence, explainability
  output (breakdown sums to score; attention contributes 0), review-adjusted score, determinism.
- `proctoringEventValidation.test.js` — schema, seq, idempotency, flood quarantine, banned-type
  rejection, client score-field stripping, timestamp sanity.
- `policySnapshot.test.js` — freeze semantics, versioning/hash, override merge order,
  `default:false` opt-in guarantee (D15: absent subdoc never enables proctoring).
- `proctoringSummary.test.js` — rollups == replayed events (the "rows == summary" discipline the
  analytics suite already enforces `[CURRENT]`).

### 29.2 Integration tests (backend)

- `proctoringLifecycle.test.js` — precheck token issuance; consent gating; **attempt+session
  created atomically at /start; duplicate /start returns same attempt+session; failed precheck
  consumes nothing; crash-window `ensureSession` self-healing**; resume/resync; device-floor 403.
- `proctoringEvents.test.js` — ingest happy path; duplicates; replayed batches; rate limits;
  cross-student ownership; completed-attempt rejection; out-of-order insertion.
- `proctoringAutoSubmit.test.js` — the D3 ladder end-to-end (warn, warn, warn, FINAL_WARN,
  SUBMIT); racing manual submit; `autoSubmitReason` recorded; leaderboard nudge still fires;
  attention-only streams never act; CV-only events never auto-submit (D8 gate off).
- `proctoringAnalytics.test.js` — summary block; **mentor scoping: mentors see assigned
  students' timelines only** (D14); CSV/Excel columns (extend the existing export-hardening
  pattern).
- `quizDuration.test.js` — §7.5 at the route level: submit 10 min past deadline without any
  client timer → `auto_submitted`; grace window behavior; resume long after deadline.
- `proctoringFeatureGate.test.js` — flag off → 503 everywhere incl. admin reads; AppSettings
  kill switch overrides quiz config; strict-CV gate off blocks any CV auto-submit path.

### 29.3 Client unit tests (root ts-jest)

- Event-buffer state machine (flush/retry/drop/overflow) — pure, node-env like existing suites.
- Episode tracker (debounce/hysteresis/cooldown derivation from policy snapshots).
- Engine state transitions (mock detector bus); screen-capture prevention hook lifecycle
  (enable on mount, release on unmount — no leak across navigation).

### 29.4 Accessibility & false-positive scenario matrix (mandatory — the fairness gate)

Goal: **do not punish normal behavior because the detector is overly sensitive.** Every scenario
runs on the device matrix; "passes" = the expected classification actually happens.

| Scenario | Expected classification |
|---|---|
| Different lighting: dim, bright, backlight, evening warm light | precheck guidance at worst; in-quiz advisory/degradation markers only — never a violation |
| Glasses (incl. glare) | normal detection; glare → suppressed CV events, no violation |
| Different camera positions: laptop hinge, phone propped left/right/high/low | baseline absorbs; no violation |
| Different distances: close, normal, far | far → precheck framing guidance; in-quiz at most `FACE_PARTIALLY_VISIBLE` minor |
| Low-end Android device (thermal, low fps) | reduced analysis rate; zero spurious events |
| Partial face visibility (hand on cheek, mic near mouth) | brief → nothing; sustained → minor episode |
| Normal head movement: nodding, stretching, shifting in chair | **nothing** |
| Normal blinking (incl. long blinks) | **nothing** |
| Brief looking away (< 2 s), glance at keyboard/desk | **nothing** |
| Looking at different screen areas | **nothing** |
| Prolonged looking away (10 s+) | `ATTENTION_DEVIATION_SUSTAINED` **record-only** episode — no warning, no violation (D6) |
| Another person briefly walks behind the student (< 3 s, small face) | filtered by size gate; at most a warn-able episode if sustained |
| Camera interruption (unplug/cover/OS revoke) | technical episode + §20.4 ladder; **no violation** |
| Network interruption 30–120 s | buffered events delivered; `HEARTBEAT_GAP` technical episode; **no violation** |
| App backgrounded < 2 s (accidental touch) | dropped by floor; **no violation** |
| App backgrounded by incoming call / permission dialog | §20.5 benign grace where recoverable; qualifying durations count per policy — never described as cheating |
| Attention calibration falls back (no baseline captured) | conservative global bands; zero behavioral difference for the student (D11) |
| Accessibility accommodations active (attention disabled, relaxed thresholds) | overrides verified end-to-end |

### 29.5 Browser tests (web surfaces, when they ship)

Chromium + Edge primary; Firefox; Safari 16+ (matrix per §14.4). Existing puppeteer-core
headless-Edge harness (`backend/scripts/verifyFeatureFreezeWeb.js` precedent) with
`--use-fake-device-for-media-stream` + face-bearing test patterns; matrix: permission denied /
fake camera / no camera. **No fullscreen tests exist — the feature is removed (D2).**

### 29.6 New verification script

`backend/scripts/verifyProctoringFlow.js` (family of `verifyPublicFlow.js` /
`verify-live-leaderboard.js`): boots real `server.js` on in-memory Mongo; drives the full
lifecycle — precheck fail → pass → consent → start (asserting exactly one attempt + one session
on double-start) → synthetic event batches (duplicates, out-of-order) → the complete D3 warning
ladder → auto-submit → timeline + summary assertions; plus a duration-bypass attempt (late
submit) asserting `auto_submitted`. PASS/FAIL report; the Phase-6 demo artifact.

### 29.7 Security tests

Forged events (cross-attempt/student) · client riskScore/violation tampering (stripped) ·
timestamp forgery (decisions unaffected) · **client-side timing manipulation cannot bypass the
server deadline (§7.5)** · replayed consent/token reuse · seq-gap floods · token-kind confusion
(guest token on student endpoints → 401 `[CURRENT]`) · rate-limit exhaustion · flag-off lockout ·
mentor cross-student timeline access → 403 (D14).

---

## 30. Observability

### 30.1 Logs

Extend `backend/utils/logger.js` usage: domain events at info/warn with `requestId` correlation;
every policy action (WARN/FINAL_WARN/SUBMIT) logged with ruleId + attemptId; flood quarantine
logged; duration-enforcement finalizations logged with reason. Client engine health mirrors into
`SESSION_DEGRADED`/`MODEL_UNAVAILABLE` events (device class + detectorVersion included).

### 30.2 Metrics — the D9 gate dimensions `[RESOLVED D9]`

Rollout decisions are made against **measurable dimensions**, not invented accuracy claims. The
digest (daily to admins until real alerting exists) tracks, per quiz and per detector version:

| Dimension | Definition |
|---|---|
| False-positive rate | review dismissals ÷ total events of type (the calibration feedback loop) |
| Detector reliability | classification agreement on supervised scenario passes + fallback-tier rate |
| Camera failure rate | camera-health episodes per active session; init failures at precheck |
| Event accuracy | episode plausibility rejects + flood quarantines per 1 000 events |
| App performance | analysis fps, CPU %, memory — self-reported by device class |
| Crash rate | app crashes / ANRs during proctored attempts vs. non-proctored baseline |
| Event delivery reliability | buffered-event loss rate (BUFFER_OVERFLOW markers); batch retry success |
| Recovery success rate | camera re-acquire success; session resync success after network gap |
| Auto-submit correctness | auto-submits reviewed and upheld as correct policy application |

Alert conditions (illustrative starting points, tuned at Stage 2): auto-submit rate > 2 % per
quiz; dismissal rate > 30 % for any event type; session failure rate > 5 %; any crash-rate
increase vs. non-proctored baseline; delivery loss > 0.5 %.

---

## 31. Rollout Strategy & Gates — Internal → Shadow → Warning → Controlled → Production

Gated by the flag trio (`aiProctoring`) **plus** the `AppSettings` global kill switch
(`proctoringEnabled`, default false, fail-closed — the `signUpEnabled` pattern). Precedence:
kill switch > flag > quiz config. The restricted strict-CV gate (D8) stays **off for the entire
V1 rollout**. Rollback at any level is safe because in-flight attempts keep frozen snapshots.

| Stage | Population | Behavior | Gate to advance (measured against the §30.2 dimensions) |
|---|---|---|---|
| **1 — Internal testing** | Team accounts, dev backend | Full flow on real devices; all modes available in dev only | §29 suites green; spike ACs hold on the device matrix; `verifyProctoringFlow.js` PASS; duration-fix tests green |
| **2 — Shadow / observation** | Opt-in real quizzes; warnings OFF, auto-submit OFF | Events + violations + risk computed and stored only; **no student-facing effect** | Session failure rate < 2 %; crash rate not above non-proctored baseline; event delivery loss < 0.5 %; camera failure rate understood; human FP sampling of episodes (dismissal < 50 % on flagged samples); perf within budget |
| **3 — Warning mode** | Wider opt-in quizzes | Warnings visible (incl. the D3 ladder's intermediate warnings); auto-submit still disabled | Warning delivery success > 99 %; dismissal rate < 30 % per type; no complaint cluster on any device class; recovery success > 90 % |
| **4 — Controlled enforcement** | Selected high-stakes quizzes; auto-submit for **deterministic focus events only** (attention remains record-only; strict-CV gate remains off) | Full D3 ladder on a narrow population | Auto-submit rate < 2 % per quiz; **every** auto-submit reviewed; > 90 % upheld as correct policy application; zero unrecovered false auto-submits |
| **5 — Production rollout** | Any admin may enable per quiz (opt-in standing policy) | Safe validated policy as the only available configuration; strict-CV gate remains off until a separate post-V1.1 decision | Standing review of the §30.2 dimensions |

Movement between stages is a product decision recorded against measured dimensions — never
automatic, never skipped.

---

## 32. Implementation Phases & Acceptance Criteria

Every phase lists scope, dependencies/prerequisites, risks, fallback, tests, and **measurable
acceptance criteria**. Phases 1–9 constitute V1; V1.1 and V2 follow separately.

### Phase 0 — CV/ML feasibility spike (MANDATORY GATE) `[RESOLVED D1, D10]`

- **Scope:** §5 — spike screen in a dev build, device matrix, measurements, written report,
  detector-tier decision (A/B/C/D), **measured device floor** (D10), screen-capture prevention
  feasibility check (D13).
- **Dependencies:** dev-build pipeline (`eas build` development profile in `eas.json`); candidate
  detector packages on the spike branch only.
- **Risks:** no tier passes on low-end devices → Tier C/D descope (accepted, planned).
- **Fallback:** the §5.4 tier ladder — downscope V1 attention scope; never ship an unusable detector.
- **Tests:** spike scenario passes + §5.5 numbers.
- **Acceptance criteria:** every §5.2 question answered with measurements in the written report;
  a tier selected and recorded in §33; the device floor measured and recorded; **Phases 3+ may
  not start until the report is accepted by the product owner.**

### Phase 1 — Foundation: data model, policy, flags, duration fix (no behavior change beyond §7.5)

- **Scope:** the four models (§26) + `ProctoringOverride`; `proctoring` subdoc + snapshot types
  (additive, explicit `default: false`); `backend/utils/proctoring/defaults.js` (provisional
  weights); `aiProctoring` flag in the mirrored trio; `AppSettings.proctoringEnabled` +
  `proctoringStrictCv` accessors; **the §7.5 duration-enforcement fix** (`durationEnforcement.js`
  + deadline computation at `/start` + lazy finalize + late-manual-submit status correction).
- **Dependencies:** none. **Prerequisites:** Phase 0 report accepted (device floor + tier recorded).
- **Risks:** duration fix touches the highest-traffic student flow.
- **Fallback:** duration fix is independently shippable and independently valuable — it ships
  even if proctoring descopes.
- **Tests:** `durationEnforcement.test.js` + `quizDuration.test.js` (the §7.5 normative tests);
  model + flag-mirror tests; full existing suite as regression gate.
- **Acceptance criteria:** (1) all seven §7.5 tests pass, including "client cannot bypass the
  limit with manipulated timing"; (2) non-proctored quizzes' observable behavior unchanged except
  late-submit status correction (reviewed + approved); (3) all 26+ existing integration suites
  green; (4) new collections exist on staging with expected indexes; kill switch + strict-CV gate
  verified fail-closed by test; (5) absent `proctoring` config can never enable proctoring (D15 test).

### Phase 2 — Lifecycle: precheck + consent + start integration

- **Scope:** `POST /:id/proctoring/precheck-report` (token, device-floor verdict),
  `POST /:id/proctoring/consent`; `/start` extension (consent + token gates, attempt+session
  creation, policy freeze, `ensureSession` self-healing); `precheck.tsx` + consent screen +
  step components + `utils/proctoringCopy.ts` (D7 centralized plain-English copy).
- **Dependencies:** Phase 1. **Prerequisites:** copy strings reviewed (§9.1 style, D7).
- **Risks:** `/start` regressions for non-proctored quizzes.
- **Fallback:** flag off → precheck not shown; `/start` behaves exactly as today.
- **Tests:** `proctoringLifecycle.test.js` (atomics, duplicate-start, crash-window self-heal,
  failed-precheck-consumes-nothing, device-floor 403); manual device pass.
- **Acceptance criteria:** (1) a proctored quiz cannot start without passed precheck + recorded
  consent (403s verified); (2) a failed precheck leaves zero attempt/session rows and retries to
  success; (3) double-tap/retry `/start` yields exactly one attempt + one session in every
  permutation incl. injected mid-sequence failure; (4) timer start = `attempt.startTime` with
  precheck time excluded (test); (5) a below-floor device is refused with the accommodation path
  (D10); (6) non-proctored quizzes byte-identical behavior; (7) all student-facing copy sourced
  from the single copy module (no inline strings — lint/test).

### Phase 3 — Camera pipeline + face presence + multiple faces + camera health

- **Scope:** `services/proctoring/` engine + native camera source + spike-chosen detector; PiP
  preview; event-buffer transport; events endpoint + rate limits; heartbeat; episode tracker;
  `taking.tsx` integration (banner); camera-health detection (§10.2).
- **Dependencies:** Phases 0–2. **Prerequisites:** Phase 0 tier-A/C detector validated.
- **Risks:** device perf variance; OEM camera quirks.
- **Fallback:** Tier C presence-only; runtime detector failure → `MODEL_UNAVAILABLE` + integrity
  signals.
- **Tests:** unit (buffer/episodes); `proctoringEvents.test.js`; emulator + device runs with fake
  feeds; §29.4 lighting/position/distance rows.
- **Acceptance criteria:** (1) zero/one/multiple faces distinguished on the supported device
  matrix (≥ 95 % correct classification across scenario passes); (2) face absence produces
  debounced structured episodes (zero frame-level rows in storage — asserted); (3) temporary
  detection loss recovers without losing the attempt or the episode; (4) camera
  covered/disconnected/revoked each produce the correct technical event and the §20.4 ladder
  holds (no auto-submit under default policy — property-tested); (5) quiz UI frame rate on the
  mid-range device unaffected (spike budget held); (6) non-proctored attempts never touch the
  camera; (7) devices below the measured floor never reach this phase (precheck refused).

### Phase 4 — Focus/integrity signals + benign grace + screen-capture prevention

- **Scope:** `AppState` → `APP_BACKGROUND` on Android; back-handler → `EXIT_ATTEMPTED`
  (policy-driven warning); web focus events where applicable; §20.5 benign-interruption
  grace/tolerance; **attempt-scoped screen-capture prevention** (`useAttemptScreenCapturePrevention`,
  D13); heartbeat gap episodes + DEGRADED transitions; legacy tab-switch dual-write (§27.5) with
  status-filter + rate-limit fix.
- **Dependencies:** Phase 3 (event transport). **Risks:** Android OEM `AppState` quirks (§14.4 —
  documented, floors absorb).
- **Fallback:** any signal unreliable on a platform defaults to `record`-only policy there.
- **Tests:** integration (ownership, completed-attempt rejection, dedup); device passes for
  background/return, call interruption, permission dialog; §29.4 focus + benign rows;
  prevention-hook lifecycle tests.
- **Acceptance criteria:** (1) 20-excursion device runs produce exactly one duration-bearing
  episode per excursion (no duplicates, no losses); (2) sub-2 s blips and permission-dialog
  interruptions produce **no** violation under default policy (§29.4 verified); (3) benign
  recovery within grace is uncounted, and repeated-beyond-tolerance benign-length interruptions
  count per §20.5 (both tested); (4) screen-capture prevention is active for the full attempt
  window, released on finalize AND on mid-attempt navigation, and never active on non-proctored
  screens (lifecycle test on device); (5) heartbeat gap + recovery produce DEGRADED→ACTIVE with
  correct timing at configured interval/timeout; (6) legacy tab-switch counter and new events
  agree during dual-write (parity test).

### Phase 5 — Head pose + record-only attention estimation

- **Scope:** head-pose derivation from the detector, baseline capture at precheck (+ D11
  fallback), `HEAD_POSE_*` + `ATTENTION_DEVIATION_*` episodes — **policy-locked to record-only**.
- **Dependencies:** Phase 3 detector tier with pose output. **Risks:** pose noise on poor cameras
  → confidence gating suppresses.
- **Fallback:** thresholds widen; worst case events stay record-only (they already are — D6).
- **Tests:** §29.4 movement/blink/glance/look-away rows; unit tests for band derivation; policy
  lock test.
- **Acceptance criteria:** (1) zero false positives across the entire normal-behavior matrix
  (no warnings, no violations — attention is record-only by construction and by test); (2)
  sustained looking-away (10 s+) and repeated patterns produce record-only episodes with
  basis/confidence metadata; (3) thresholds read from the policy snapshot (no hardcoded angles);
  (4) **no V1-representable policy can escalate attention events to any action** (property
  test, D6); (5) calibration fallback path produces no behavioral difference (D11).

### Phase 6 — Rules engine + risk scoring + the D3 warning ladder + auto-submit

- **Scope:** `rulesEngine.js`/`riskScore.js`/`sessionHealth.js` wired into ingest; violation
  records; warning delivery (response + socket + banner, centralized copy); the §20.3 focus
  ladder incl. FINAL_WARN; auto-submit via existing finalize with reasons; duration-fix interplay.
- **Dependencies:** Phases 3–5 event types. **Risks:** policy bugs double-counting — mitigated by
  replay-derived counters + CAS (tested).
- **Fallback:** engine ships with conservative default policy; `warn-only` available; strict
  knobs absent from quiz UI entirely (D8).
- **Tests:** `proctoringRules/Risk/AutoSubmit` suites incl. property tests (§29.1);
  `verifyProctoringFlow.js` end-to-end incl. full ladder + late-submit duration bypass.
- **Acceptance criteria:** (1) the §18.4/§20.3 sequences hold by test: 3 warned violations →
  FINAL_WARN at #4 → SUBMIT at #5 — and never a silent submit; (2) duplicate/out-of-order replay
  changes neither violation counts nor risk (bit-stable); (3) every auto-submit carries a
  complete `autoSubmitReason` and executes exactly once under concurrency (CAS); (4) every
  warning (incl. FINAL_WARN) persisted and delivered-or-queued; (5) per-event breakdown sums
  exactly to the stored risk score; attention events contribute 0 (D6); (6) strict-CV gate off
  blocks every CV auto-submit path (D8 test).

### Phase 7 — Admin + mentor timeline, analytics, review workflow

- **Scope:** timeline/summary endpoints; `'proctoring'` analytics tab; `AttemptDetailModal`
  extension; review actions; `collectTestReportData`/CSV/Excel columns; overrides CRUD;
  student-visible own-timeline.
- **Dependencies:** Phase 6. **Risks:** analytics parity drift — shared collector mitigates.
- **Tests:** `proctoringAnalytics.test.js` (app/CSV/Excel parity; **mentor scoping** D14);
  review permission tests.
- **Acceptance criteria:** (1) an admin **and an assigned mentor** can reconstruct any flagged
  attempt end-to-end from the timeline alone (episodes, warnings, actions, review trail); (2)
  mentors see assigned students only — cross-student access 403s (tested); (3) exports carry
  proctoring columns identical to app data (parity test); (4) review decisions update
  `integrityStatus` and show adjusted-vs-original scores; (5) students see their own timeline
  and nothing about others.

### Phase 8 — Hardening: full test matrix, calibration, accessibility overrides

- **Scope:** complete §29.4 matrix on the device matrix; §29.7 security pass; accommodation
  overrides end-to-end; observability digest (§30.2 dimensions); threshold calibration round 1.
- **Dependencies:** Phases 2–7. **Risks:** FP rate too high → hold in shadow (§31) until tuned.
- **Tests:** everything above, executed.
- **Acceptance criteria:** (1) every §29.4 row passes on every device class; (2) security tests
  pass incl. duration-bypass and client-tamper cases; (3) accommodation override (attention
  disabled for a student) demonstrably removes those events while keeping the rest; (4)
  calibration report exists with measured per-type FP rates and tuned values recorded; (5) the
  daily metrics digest renders all nine §30.2 dimensions.

### Phase 9 — Staged rollout execution

- **Scope:** §31 stages 1→5 with recorded metric gates; strict-CV gate confirmed off throughout.
- **Acceptance criteria:** each stage's gate dimensions met and recorded before advancing; first
  live proctored quiz completes with review sign-off and no critical incident; rollback drill
  executed once (kill switch → behavior reverts).

### V1.1 phases (after V1 stabilizes; each gated on real data)

- **V1.1-a improved attention/gaze** — only if Phase 0 validated Tier B: iris-based estimation,
  multi-point calibration, per-tier thresholds; still observational; AC: measurable FP reduction
  vs. V1 on the same scenario suite, behind `attention.mode` config which remains `'record'`.
- **V1.1-b the record-only graduation decision** — with calibration data, decide (via a rollout
  gate + D8 framework) whether attention events may ever warn; AC: decision recorded with
  measured FP/FN evidence.
- **V1.1-c calibration round 2 + episode tuning** — re-tune weights/thresholds/debounce from
  shadow+warning data; AC: dismissal rates under §31 Stage-3 gates on two consecutive weeks.

### V2 placeholders (not scheduled; plug into the same architecture)

Phone detection · object detection · advanced behavioral analysis · guest/public-quiz
proctoring · registered-web surface · live-invigilation nudge. **None block V1.**

---

## 33. Decision Log — D1–D15 RESOLVED

All prior open decisions are resolved as follows; the plan text above implements them throughout.

| ID | Decision | Resolution (applied in) |
|---|---|---|
| D1 | Native CV/ML detector | **Chosen by the Phase 0 spike, not by assumption** — mandatory prerequisite; tier ladder A/B/C/D with pre-agreed descope (§5) |
| D2 | Fullscreen | **REMOVED from the proctoring system entirely** — no enter/maintain/detect/warn/auto-submit anywhere; focus/app/tab monitoring unaffected (§15, §14) |
| D3 | Focus/tab/app switching | Detected where supported → recorded → counted → **warned every time**; default tolerance **3** (configurable ~3–4); FINAL warning before enforcement; then auto-submit. Never silent, never described as cheating (§14.2, §20.3) |
| D4 | Benign interruptions | Grace period + tolerance mechanism: ~2 s grace floor, benign recovery uncounted, repeated-beyond-tolerance counts; configurable grace/debounce/tolerance/recovery/counting (§20.5) |
| D5 | Risk weights & thresholds | Transparent **provisional** values, clearly labeled, tuned via the 6-step calibration process; explainable per-event breakdowns; never a black box (§19) |
| D6 | Attention/gaze | **RECORD-ONLY in V1 — FINAL.** No auto-submit, termination, severe violation, or warnings from attention events; timeline observations only; no V1-representable policy can escalate them (§13.1) |
| D7 | Consent & warning text | Short, plain English, centralized in a copy module (updateable without logic changes); no legal-style wording (§9) |
| D8 | Strict CV configuration | **Restricted:** not a per-quiz toggle; controlled `AppSettings`-level gate (default off, fail-closed, admin-audited), off for the entire V1 rollout (§21.3) |
| D9 | FP targets & rollout gates | Measurable gate dimensions (false-positive rate, detector reliability, camera failure rate, event accuracy, app performance, crash rate, delivery reliability, recovery success, auto-submit correctness) instead of invented accuracy numbers (§30.2, §31) |
| D10 | Minimum supported device | Floor **measured in Phase 0** (RAM/CPU/camera/FPS/thermal/UI perf); below-floor devices are refused at precheck with an accommodation path — no unreliable monitoring (§5.3, §8.2) |
| D11 | Calibration | Not a hard blocker; conservative-default fallback when calibration can't complete; students never punished for calibration failure; attention is record-only regardless (§13.4) |
| D12 | Server-side quiz duration | **FIX INCLUDED IN THIS WORK:** server-computed deadline for flat quizzes, lazy enforcement, late-manual-submit correction, tests proving client timing cannot bypass (§7.5, Phase 1) |
| D13 | Screen-capture prevention | Enabled **during active attempts only**, where technically supported; deterrence, not evidence; platform limitations documented; released on attempt end (§15) |
| D14 | Mentor visibility | Mentors view proctoring timelines for **assigned students**, same access model as quiz results, backend-enforced; structured info only (no images exist) (§25.1) |
| D15 | Proctoring default | **OPT-IN, default OFF**; explicit enable required; existing quizzes never become proctored; explicit `default: false` (no missing-means-on trap) (§21.2) |

**Remaining approvals required before/along implementation** (the only open items):

1. Accept the Phase 0 spike report — detector tier + measured device floor (gates Phase 3+).
2. Approve the final plain-English copy strings during Phase 2 review (style already fixed by D7).
3. Approve calibration-tuned threshold/weight values at each rollout gate (process fixed by D5/D9;
   the measured values themselves are approved as they are produced).

---

## 34. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | False positives flag honest students | High initially | Trust damage | duration+repetition+confidence; personal baseline; record-only attention (D6); review-before-consequence stages; dismissal-rate gates (§19.5, §31) |
| R2 | Detector/CV perf degrades low-end devices | Medium | Exam usability | Phase 0 gate + measured device floor (D10) + fps/CPU budget + fallback tiers (§5) |
| R3 | Chosen detector proves unreliable late | Low (spike-gated) | Rework | tier ladder with pre-agreed descope (§5.4); replay-derived data re-scores without re-running students |
| R4 | Auto-submit incidents | Low-Med | Severe (lost attempts) | D3 ladder (never silent, FINAL_WARN first); deterministic-only enforcement in rollout Stage 4; camera grace ladder; appeal via existing retest flow (§20, §23, §31) |
| R5 | Event flood / API abuse | Medium | Backend load, timeline noise | rate limits, quarantine, idempotency (§18.6, §27) |
| R6 | Scope creep (live invigilation, audio, evidence, fullscreen "just for real exams") | Medium | Timeline blowout | §4.4 hard exclusions incl. fullscreen REMOVED + `[FUTURE / V2]` markers enforced in review |
| R7 | Shared student credentials limit attribution | Certain (current state) | Misdirected conclusions | documented external limitation; "account" framing in UI; no identity work (§4.4) |
| R8 | Feature-freeze mirrors drift | Low | Frozen-surface confusion | three-file same-commit rule + gate test (§6.6) |
| R9 | Single-instance backend absorbing new write load | Low at current scale | Latency | batched ingest, denormalized counts, documented Redis path (§2.2) |
| R10 | Fairness disparities across skin tones/environments | Possible | Discrimination harm | §29.4 matrix is a phase gate; spike + calibration sample diversity; detector swap path |
| R11 | Legacy tab-switch migration inconsistency | Low | Analytics drift | dual-write window + parity test (§27.5) |
| R12 | `/start` + duration-fix regressions on the highest-traffic student flow | Low | Outage | Phase 1/2 zero-change guarantees for non-proctored quizzes + the full existing suite as the gate (§32) |
| R13 | Students defeated by device floor | Medium (fleet-dependent) | Access complaints | accommodation path + contact-admin at precheck; floor measured, not assumed (D10); revisit with data |

---

## 35. Final Recommended Architecture

```
PRECHECK
   ↓
CONSENT
   ↓
START ATTEMPT
   ↓
CREATE QUIZ ATTEMPT  +  CREATE PROCTORING SESSION  +  FREEZE POLICY
(+ server-computed duration deadline, D12; + attempt-scoped screen-capture prevention, D13)
   ↓
ACTIVE QUIZ
   ↓
┌───────────────────────────────┐
│ Signal Sources (client)       │  observations only — never decisions:
│                               │  Camera/Face CV · Head Pose ·
│  Camera / Face CV             │  Attention/Gaze Estimation (record-only, V1) ·
│  Head Pose                    │  Camera Health · App/Tab/Focus Signals ·
│  Attention/Gaze Estimation    │  Network / Heartbeat
│  Camera Health                │
│  App/Tab/Focus Signals        │
│  Network / Heartbeat          │
└───────────────┬───────────────┘
                ↓
        Signal Processing          debounce · hysteresis · confidence gating ·
                ↓                   cooldown · local buffer/retry (episodes, not frames)
        Structured Events          categorized: technical | cv_observation | integrity
                ↓                   (immutable, idempotent, serverAt-ordered)
          Rules Engine             SERVER, pure functions over the frozen policy snapshot
                ↓
       Violation Evaluation        deterministic policy events vs probabilistic CV signals;
                ↓                   attention locked record-only in V1 (D6)
          Risk Scoring             SERVER, provisional additive weights, fully explainable
                ↓
        Quiz Policy Engine         per-quiz snapshot decides:
      ┌─────────┼─────────┐
      ↓         ↓         ↓
   Continue   Warn    Auto-submit (server-executed via existing CAS finalize;
              (incl.    warn-ladder first per D3; duration deadline per D12)
              FINAL_WARN)
                ↓
       Admin / Mentor Event Timeline  (+ review: confirm/dismiss/escalate; D14 access)
```

**Layer responsibilities in one line each:** signal sources observe; signal processing shapes raw
detections into episodes; events persist categorized evidence; the rules engine decides what
counts; risk summarizes explainably; the policy engine acts; actions execute server-side;
admin/mentor analytics present for human judgment. **AI/CV produces observations; the rules
engine determines policy; the backend remains authoritative; the system never simply declares
"AI detected cheating."**

**Why this fits this codebase:** it copies the platform's proven doctrines — ownership-embedded
queries, CAS finalize for exactly-once state changes, snapshot-at-start for frozen per-attempt
config, single-source analytics, and the fail-closed `AppSettings` singleton — so the proctoring
feature inherits battle-tested safety properties, and the D12 duration fix leaves the exam
system strictly more trustworthy than before.

---

## 36. Consolidated Summary

The single-look answer to "what exactly are we building." Body sections are normative.

**1. Final V1 scope** (§4.1) — Precheck: camera permission, availability, exactly one face,
basic face visibility, basic lighting, device capability (measured floor), network, monitoring
explanation, consent, clear failure/retry states — **no fullscreen requirement**. During quiz:
face presence, multiple-face detection, face visibility, face outside usable frame, camera
interruption/failure (with recovery ladder), basic head orientation, **attention/gaze estimation
record-only**, tab switching, app/focus loss with grace/tolerance for benign interruptions,
structured event timeline, heartbeat/session health, server-authoritative rules/policy, student
warnings, auto-submit after the configured repeated focus threshold, screen-capture prevention
during active attempts where supported, and the server-side duration fix.

**2. V1.1 scope** (§4.2) — improved attention/gaze (spike-gated, still observational), the
record-only graduation decision, episode/threshold/risk calibration from real data.

**3. V2/future scope** (§4.3) — phone/object detection, advanced behavioral analysis, advanced
gaze, guest/public proctoring, registered-web surface, live invigilation. Plugs into the same
architecture; blocks nothing.

**4. Explicit out-of-scope items** (§4.4) — evidence screenshots · stored student images ·
identity verification · question randomization · **fullscreen enforcement** · advanced
object/phone detection · aggressive gaze-based auto-submit · perfect gaze tracking ·
legal/compliance implementation.

**5. Phase 0 feasibility spike** (§5) — answers detector choice, real-device performance,
frame-processing viability, failure behavior, device floor, screen-capture feasibility; tier
ladder with pre-agreed descoping; **no CV implementation before its report is accepted.**

**6. Final attempt/proctoring lifecycle** (§7) — Instructions → Precheck (creates nothing) →
Consent (keyed quiz+student+policyVersion) → `/start` creates attempt + session + frozen policy
+ duration deadline + prevention enable, atomically-enough with self-healing; timer starts at
`attempt.startTime`; enforcement starts at session creation; full idempotency table; server-only
transitions.

**7. Final state machine** (§22) — `NOT_STARTED → PRECHECK → READY → CONSENTED → ACTIVE ⇄
DEGRADED/RECOVERED → SUBMITTED → SESSION_CLOSED`, with retryable `PRECHECK_FAILED`, warnings as
in-band actions, `AUTO_SUBMIT` as a server action ending in the existing `auto_submitted` status.

**8. Final event architecture** (§17) — episode-based (start/end/duration/confidence/metadata),
categories `technical | cv_observation | integrity | system_action`, deterministic vs
probabilistic classes, idempotency + episode keys + precedence dedup, `serverAt` authoritative,
banned-verdict identifiers, no fullscreen type, extensible for V2.

**9. Final focus/tab/app switching policy** (§14, §20.3) — detect where supported → record →
count → warn every qualifying episode; default tolerance 3 (configurable 3–4); FINAL warning;
then server auto-submit. Blips dropped; prolonged absence specially weighted; never silent;
never "cheating."

**10. Final grace-period/tolerance mechanism** (§20.5) — ~2 s grace floor; benign recovery
uncounted; repeated-beyond-tolerance (illustrative 5/5 min) counts; configurable
grace/debounce/tolerance/recovery/counting; benign causes (calls, dialogs, popups) never assumed
to be cheating.

**11. Final risk-scoring approach** (§19) — provisional transparent additive weights (attention
contributes 0 in V1); caps and recovery credit; five advisory bands; per-event explainable
breakdown; 6-step calibration; replay-derived.

**12. Final attention/gaze approach** (§13) — head-pose-based estimation, **record-only in V1**
(no warnings/violations/auto-submit under any V1 policy — property-tested), personal baseline
with safe fallback (D11), normal behavior protected, terminology "attention/gaze estimation"
never "eye tracking"; V1.1 may improve only with spike-proven tech.

**13. Final camera-failure/recovery behavior** (§20.4) — record always → 10 s silent grace →
banner + up to 3 re-acquires → warn every ~30 s while unresolved → strict policy may submit only
after ≥ ~60 s sustained + failed rejoins; camera-optional continues unmonitored with recorded
intervals.

**14. Final screen-capture prevention behavior** (§15) — enabled during active attempts only
(expo-screen-capture, mount-scoped), released on end/unmount; Android flagSecure blocks
screenshots/recents; iOS detect-only at best; web none — recorded as `deterrenceApplied` on the
session; pure deterrence, never evidence, never claimed as protection.

**15. Final mentor/admin access model** (§25.1) — admin: all; mentor: assigned students only
(`assertStudentPerformanceAccess`, backend-enforced); student: own. Structured proctoring info
only (timeline, types, timestamps, durations, confidence, violations, risk, policy outcome) — no
images exist to expose.

**16. Final server-authoritative timing behavior** (§7.5) — one source of truth:
server-computed `durationDeadline` for flat quizzes (startTime + duration [+ grace]) and
`sectionStates[].endsAt` for section-locked; lazy enforcement on every attempt touch; late
manual submits finalize as `auto_submitted`; client timers display-only; seven normative tests
prove client-side timing cannot bypass the limit.

**17. Device/browser/platform limitations** (§14.4) — Android can't distinguish background
causes; iOS `inactive` noisy; system overlays often undetectable; screenshot detection
unavailable (prevention only, iOS can't block); web `beforeunload` advisory; camera
permission-revocation timing imprecise; fullscreen n/a (removed). Undetectable situations
degrade to "unmonitored interval", never accusations.

**18. Implementation dependencies** (§32) — Phase 0 → 1 → 2 → {3, 4} → 5 → 6 → 7 → 8 → 9;
V1.1 after V1; V2 unscheduled. External prerequisites: EAS dev-build pipeline for any native
detector (Expo Go insufficient). No dependency on identity, evidence, fullscreen, or legal work.

**19. Acceptance criteria** (§32 per phase, measurable) — highlights: duration bypass impossible
(Phase 1); failed precheck consumes nothing + exactly-one attempt/session on duplicates (Phase
2); ≥ 95 % face-count classification + zero frame rows (Phase 3); 20-excursion integrity runs
with no blip violations + prevention lifecycle (Phase 4); zero false positives on the
normal-behavior matrix + attention locked record-only (Phase 5); the full D3 ladder bit-stable
under replay + exactly-once auto-submit (Phase 6); mentor scoping + export parity (Phase 7);
full matrix + security pass (Phase 8); recorded rollout gates + rollback drill (Phase 9).

**20. Testing strategy** (§29) — backend unit/integration (rules, risk, duration, lifecycle,
events, auto-submit, analytics, gates); client unit (buffer, episodes, engine, prevention
hook); the §29.4 accessibility & false-positive matrix on the device matrix; browser tests with
fake media (web surfaces, no fullscreen tests); `verifyProctoringFlow.js` end-to-end script;
security tests incl. timing manipulation and cross-student access.

**21. Rollout gates** (§31) — Internal → Shadow (no student-facing effect) → Warning (no
auto-submit) → Controlled enforcement (deterministic focus events only, every auto-submit
reviewed) → Production (opt-in per quiz; strict-CV gate off). Each stage advances only on the
nine measured §30.2 dimensions, recorded as a product decision.

**22. Remaining decisions requiring approval** (§33) — only three: (1) accept the Phase 0 spike
report (detector tier + measured device floor); (2) approve final plain-English copy strings in
the Phase 2 review; (3) approve calibration-tuned threshold/weight values at each rollout gate.
Everything else is decided and encoded above.

---

## 37. Phase 1 Implementation Record (2026-09-15)

Phase 1 (§32) is **implemented and verified**. This section records what was built, the
deviations from the letter of the plan, and the validation performed. Planning text above is
unchanged and remains normative for Phases 2–9.

### 37.1 What was implemented

| Area | Files |
|---|---|
| Five new collections (§26) | `backend/models/Proctoring{Session,Event,Consent,Violation,Override}.js` — registered at startup in `backend/server.js` so collections/indexes exist; no evidence/image fields anywhere |
| Proctoring utils | `backend/utils/proctoring/{defaults,policySnapshot,eventRegistry,eventValidation,durationEnforcement,session}.js` |
| Quiz config subdoc (§21.2, D15) | `backend/models/Quiz.js` — `proctoring` with explicit `enabled: {default: false}`; `attention.mode` enum-locked to `'record'` (D6); validated via `parseProctoringConfig` in `POST /create-from-bank` and `PUT /:id` (400 on unknown keys, out-of-range values, attention escalation, per-quiz riskWeights, CV-submit modes, zero-tolerance warn-then-submit) |
| Attempt fields (§26.5) | `backend/models/QuizAttempt.js` — `durationDeadline`, `proctoringSnapshot` (write-once), `autoSubmitReason` |
| **§7.5 duration fix (D12)** | deadline computed server-side at `/start` for flat attempts (`startTime + duration`); lazy enforcement (`syncExpiredDuration`) on answer save, `GET /attempt/:id`, `/start` resume; late manual submits finalize `auto_submitted` with `autoSubmitReason {kind:'duration'}` via `resolveSubmissionStatus` inside `finalizeQuizAttempt`; 30 s network grace; section-locked attempts untouched (endsAt cascade stays sole authority) |
| Policy snapshot at /start | frozen `proctoringSnapshot` {version, hash, policy, frozenAt} on the attempt + `ProctoringSession` (ACTIVE, 1:1 unique `{attempt}`) created in the same sequence; idempotent `ensureProctoringSession`; crash-window self-heal on resume; immutability guaranteed (snapshot only ever written at creation) |
| Rollout controls | `AppSettings.proctoringEnabled` + `proctoringStrictCv` (both default false, fail-closed accessors, admin-audited writes via `PUT /api/settings/proctoring{,-strict-cv}`); `aiProctoring: false` in all three mirrored flag files (drift alarm covers it); precedence kill switch > flag > quiz config enforced at `/start` |
| Session close on finalize | `closeProctoringSessionForAttempt` on the finalize winner branch (manual, section cascade, and duration finalizes all converge there; best-effort — never rolls back a finalize) |

### 37.2 Deviations and reviewed decisions

1. **One-attempt rule now counts `auto_submitted`.** The old `/start` check blocked only
   `status:'completed'`, so ANY expired attempt (pre-existing for section cascades; made
   reachable for every flat quiz by the duration fix) allowed a **fresh restart** — a full new
   time window that would bypass §7.5 entirely. The check now uses
   `status:{$in:['completed','auto_submitted']}`; the approved-retest escape hatch covers both
   statuses unchanged. This is the one observable behavior change for non-proctored quizzes
   beyond the late-submit status correction (accepted under Phase 1 criterion 2, reviewed here).
2. **Concurrent `/start` convergence instead of a unique index on `QuizAttempt`.** A partial
   unique index on existing collections could fail to build against legacy duplicate
   `in_progress` docs in production; convergence (earliest `startTime`, ties by `_id`, loser
   deleted only while still empty) achieves exactly-one-attempt semantics with zero migration
   risk. The NEW `ProctoringSession` collection does use its unique `{attempt}` index.
3. **Snapshot identity.** The session stores `{version, hash}` referencing the attempt's frozen
   snapshot; no separate policy-snapshot collection was created (`policySnapshotId` from §26.1
   is realized as the attempt-embedded snapshot + hash pair).
4. **Response field names.** `/start` returns `durationDeadline`, `serverNow`,
   `proctoringSessionId`, `proctoringPolicyDigest` (plan §7.1's `deadline`/`sessionId`/
   `policyDigest` semantics, named consistently with the stored fields). All additive —
   existing clients ignore them.
5. **No consent/precheck gating yet** (Phase 2 per §32). Phase 1's `/start` creates snapshot +
   session for fully-eligible proctored quizzes without a consent gate — safe because all three
   rollout gates default OFF, so no production quiz can be proctored until an admin enables
   them deliberately.
6. **Settings toggles sit behind the feature freeze** like `signUpEnabled` today (router frozen
   under `userManagement`); they answer 503 until that flag re-enables. The kill switch also
   fails closed on DB errors.
7. **Legacy in-flight attempts are never retro-proctored**: resume only self-heals sessions for
   attempts that have a snapshot (proctored at creation); kill-switch rollback leaves existing
   sessions riding on their frozen snapshots (§31) and stops creating new ones.
8. **`ProctoringEvent.type` is enum-locked to the registry** at the model layer, so banned
   verdict identifiers cannot be persisted even by direct model writes.

### 37.3 Tests performed

| Suite | Result |
|---|---|
| `tests/unit/proctoring/policySnapshot.test.js` (D15 opt-in guarantee, gate precedence, hashing/versioning, authoring validation incl. D6/D8 locks) | 29 passed |
| `tests/unit/proctoring/durationEnforcement.test.js` (deadline computation, grace boundary, status resolution, section-lock deflection, skew resistance) | 22 passed |
| `tests/unit/proctoring/eventRegistry.test.js` (registry invariants, banned identifiers, no fullscreen type, validation + server-field stripping) | 16 passed |
| `tests/integration/quizDuration.test.js` — the §7.5 normative tests 1–7 + regression cases | 12 passed |
| `tests/integration/proctoringFoundation.test.js` — collections/indexes, gates, snapshot immutability, duplicate + concurrent starts, self-heal, session close, authoring validation, settings lifecycle | 28 passed |
| Full backend suite (regression gate, criterion 3) | all suites green |
| Flag-mirror drift alarm (`featureGate.test.js`) | green with `aiProctoring` added to all three files |

### 37.4 Remaining blockers

None for Phase 1. Phase 2 (precheck + consent + `/start` gating) can start immediately; Phase 3+
remains gated on the Phase 0 on-device runbook (`docs/phase-0-cv-spike-report.md` Appendix C).

---

## 38. Phase 2 Implementation Record (2026-09-15)

Phase 2 (§32) is **implemented and verified**: Instructions → Precheck → Consent → gated
server-authoritative `/start` → attempt + `ProctoringSession`. Precheck and consent never create
attempts/sessions; `/start` enforces both server-side before creating anything.

### 38.1 What was implemented

| Area | Files |
|---|---|
| Precheck-report endpoint (§8.8, §27.2) | `backend/routes/proctoring.js` `POST /api/quizzes/:id/proctoring/precheck-report` — schema-validates client observations (server-owned check vocabulary), maps them to PASS/RETRYABLE/FAIL/UNSUPPORTED server-side, issues the signed short-TTL precheck token on PASS only; device floor (D10) enforced here (403 `DEVICE_BELOW_FLOOR` + accommodation path); camera:'optional' quizzes record-and-proceed (§8.3) |
| Precheck token | `backend/utils/proctoring/precheckToken.js` — JWT (`kind:'proctoring_precheck'`) bound to {student, quiz, policyHash}, 30 min TTL, carries the compact summary later persisted on consent |
| Verdict engine (pure) | `backend/utils/proctoring/precheckReport.js` — `parsePrecheckReport` (strict validation) + `evaluatePrecheckReport` (verdict mapping incl. floor, camera-optional, retryable-vs-hard) + provisional floor constants in `defaults.js` |
| Consent endpoint (§9.3) | `POST /:id/proctoring/consent` — requires a valid token for the CURRENT policy hash; idempotent upsert {quiz, student, policyVersion}; persists consentTextVersion + precheckSummary + surface |
| /start gating (§7.1) | `backend/utils/proctoring/startGating.js` + `quizzes.js`: consent-for-current-hash → 403 `PROCTORING_CONSENT_REQUIRED`; token → 403 `PROCTORING_PRECHECK_REQUIRED` / `PRECHECK_TOKEN_INVALID`; runs BEFORE any creation (zero rows on failure); resume never re-gates |
| Rate limiting | `backend/middleware/proctoringRateLimit.js` — 10 reports/hour/student/quiz (otpRateLimit pattern) |
| Routing hint | `GET /quizzes/:id` adds `proctoringRequired` for students (same eligibility resolver as /start) |
| Mobile precheck + consent UI | `app/(tabs)/quizzes/[id]/precheck.tsx` (step statuses, camera preview, retry, settings deep-link, guidance hints, consent checkbox, Start); `instructions.tsx` routes proctored starts through it; `QuizContext.startQuiz` accepts `{precheckToken}` |
| Copy module (D7) | `utils/proctoringCopy.ts` — every student-facing proctoring string keyed + `CONSENT_TEXT_VERSION`; honesty lines ("No photos or videos are recorded or stored"); banned-language test |
| Detector boundary | `services/proctoring/detector.ts` — `FaceReadinessDetector` interface; Tier A implementation reuses the Phase 0 spike binding + pure classifier UNCHANGED; reports honestly UNSUPPORTED when the native module is absent (never fakes results); Phase 3 swaps only the factory |
| Pure client logic | `services/proctoring/precheck.ts` — face-frame majority aggregation + report building (root-jest unit-tested) |

### 38.2 Deviations and reviewed decisions

1. **Eligibility == gating.** Consent + precheck are demanded exactly when the Phase 1 eligibility
   resolver says the quiz is proctored (kill switch > flag > quiz opt-in). Gates off → the quiz
   behaves like any non-proctored quiz (full rollback; no consent demanded for unproctored starts).
2. **Precheck reports are attestations, not proofs.** The client reports observations; the server
   validates the schema and decides the verdict, and the credential (token) is unforgeable — but a
   modified client can lie about its camera. This is the plan's design (§24.1/§24.3: "skip
   consent/precheck → direct POST /start → 403"); the honest-hardware gap closes with Phase 3+
   session telemetry (heartbeat/camera-health events make absence visible).
3. **Device floor is the Phase 0 provisional hypothesis** (Android API ≥ 26; RAM enforced only when
   reported — the app has no RAM source without a new dependency). Clearly labeled in
   `defaults.js`; the measured runbook floor replaces the constants with no code change.
4. **Failed-report storage**: aggregates are logged (structured) and carried on the consent record
   via the token; no separate report collection (kept the schema additive; §8.8's "optional"
   support-analytics report realized as logs + consent summary).
5. **Spike type-only fix**: `modules/proctoring-spike/src/index.ts` re-exported a type without
   binding it locally (pre-existing latent TS2304, surfaced by the new import). Fixed with an
   `import type` line — zero runtime change, no spike behavior touched.
6. **Token expiry vs. consent**: an expired/stale token fails consent AND /start with
   `PRECHECK_TOKEN_INVALID`; a policy-hash change additionally invalidates consent
   (`PROCTORING_CONSENT_REQUIRED` — re-consent flow, §21.4).
7. **Resume never re-gates** (§7.2): a student mid-attempt is never blocked by re-consent; only
   NEW attempts demand current consent + token.

### 38.3 Tests performed

| Suite | Result |
|---|---|
| `tests/unit/proctoring/precheckReport.test.js` (schema validation, floor, verdict matrix incl. camera-optional) | 31 passed |
| `tests/integration/proctoringLifecycle.test.js` (token issuance, forgery/expiry/cross-binding, consent idempotency, direct-bypass 403s with zero rows, gated start = exactly one attempt/session, concurrent starts, timer-start-after-consent, rollback, non-proctored unchanged, GET hint) | 35 passed |
| `tests/integration/proctoringFoundation.test.js` (Phase 1 mechanics — updated to walk the real gated path) | 28 passed |
| Root jest: `services/__tests__/proctoringPrecheck.test.ts` (aggregation, report building, copy-module honesty + single-source screen scan) | 11 passed |
| Full backend suite | 677+ passed; only the pre-existing `excelParser` whitespace failure remains (fails on the clean tree too) |
| Root jest suite | 8 suites, 91/91 |
| `tsc -p tsconfig.proctoring.json` (+ `tsconfig.spike.json` now clean) and ESLint on changed files | 0 errors |

### 38.4 Remaining blockers

None for Phase 2. Manual on-device pass (camera/face precheck UX on a real Android dev build)
is recommended before any rollout gate advances; Phase 3+ remains gated on the Phase 0 runbook.

### 38.5 Post-review fixes (2026-09-15, /code-review medium)

Seven findings verified real and fixed; one (settings toggles unreachable under the feature
freeze) is the documented §37.2.6 behavior — surfaced as a rollout-day decision (allowlist the
admin proctoring toggles, or unfreeze userManagement first), not changed here.

| Fix | What changed |
|---|---|
| `TIME_EXPIRED` client handling | `QuizContext.isFinalWriteRejection` now treats the Phase 1 duration-finalize 403 as terminal (write dropped like `SECTION_LOCKED`) instead of retrying forever |
| Proctored resume dead-end | `instructions.tsx` probes `/start` first for proctored quizzes — an `in_progress` attempt resumes without re-gating; only a 403 `PROCTORING_*` routes through precheck. `precheck.tsx` handles `PROCTORING_DISABLED` (rollback) by starting ungated instead of looping on 503 |
| Precheck race fixes | re-entrancy guard moved to a ref; auto-run waits for the camera-permission query to resolve; an unresolved permission reports RETRYABLE (never a spurious hard FAIL that burned rate-limited reports) |
| Concurrency stranding | `convergeConcurrentStart` now deletes ONLY the attempt its own request created — a racer that already responded can never have its attempt deleted out from under a client (canonical order = `startTime, _id`, same as the resume lookup). Three-way concurrency test added |
| `enabled` string handling | `parseProctoringConfig` accepts booleans and exact `'true'/'false'` strings (any case) and rejects everything else with 400 — `'TRUE'` can no longer silently persist a disabled quiz |
| Eligibility dedup | rollout precedence wiring lives once in `utils/proctoring/rollout.js` (`resolveEligibilityForQuiz`), used by both `/start` and the precheck/consent routes |
| Spike pause/resume | `CameraLoop.resume()` no longer spawns a second capture loop while the parked one keeps polling (would have corrupted the Phase 0 runbook FPS/latency measurements); spike suite 39/39 green |









## 39. Phase 3 Implementation Record (2026-09-15)

Phase 3 (§32) is **implemented and verified by automated tests**. The Phase 0 gate remains
**CONDITIONAL GO** (on-device runbook pending, report §28/Appendix C) — therefore the Tier A
detector is wired in as the production detector but is **NOT production-validated**: no
classification-accuracy or sustained-performance claim is made, the Phase 3 acceptance criteria
that require the device matrix (AC 1, 5 and the device half of 7) remain **pending device
validation**, and every rollout gate (kill switch · feature flag · quiz opt-in) stays OFF so no
production quiz can be proctored until the runbook passes and gates are deliberately enabled.

### 39.1 What was implemented

| Area | Files |
|---|---|
| Event ingest endpoint (§27.2) | `backend/routes/proctoringEvents.js` — `POST /api/quizzes/:id/attempt/:attemptId/proctoring/events`: ownership-embedded lookups, client-echo sessionId match (403 `SESSION_MISMATCH`), **lazy §7.5 duration finalize first**, session-state gating (409 `SESSION_NOT_ACTIVE` + `integrity.batchesRejected` counter + structured post-close telemetry log — payload never stored), per-event validation via the Phase 1 sanitizer, idempotency-key dedup (incl. concurrent-insert race convergence), server-owned record shaping, denormalized `eventCounts`, heartbeat `lastSeenAt`, set-once heartbeat parameters from the **frozen** policy, flood flag (accepted-but-flagged, never dropped) |
| Session resync endpoint (§27.2) | `GET /api/quizzes/attempt/:attemptId/proctoring/session` — owner/admin/assigned-mentor access (the `GET /attempt/:id` rule), returns session state + the frozen policy + heartbeat parameters; crash-window self-heal for in-flight attempts |
| Pure ingest helpers | `backend/utils/proctoring/eventIngest.js` — envelope validation (batch cap 50, seq/last-clientSeq consistency, heartbeat-only batches, `bufferOverflow` counter), `buildEventRecord` (serverAt/severity/category/durationMs/detectorTier — the ONLY place server-owned fields are computed), flood outcome |
| Ingest constants | `backend/utils/proctoring/defaults.js` — `EVENT_BATCH_MAX_EVENTS` 50, `EVENT_FLOOD_SESSION_CAP` 500, `EVENTS_RATE_LIMIT` 60/min, provisional server-side severity map (attention rows `'info'` — D6) |
| Rate limiting | `backend/middleware/proctoringRateLimit.js` — `proctoringEventsRateLimit` (60 batches/min/student, otpRateLimit pattern) |
| `/start` + resync extensions | `backend/routes/quizzes.js` — `/start` (new + resume) responses gain `proctoringPolicy` (the frozen snapshot; additive); `GET /attempt/:id` gains a compact `proctoringSession {id, status}` hint (§6.4 engine re-arm) |
| Client engine (§6.3, §10, §11) | `services/proctoring/engine.ts` — one engine per attempt; reuses the Phase 0 `CameraLoop` unchanged (sequential pacing, pause/resume/stop, failure tolerance); failure taxonomy (§10.2): detector→`MODEL_UNAVAILABLE`, permission→`CAMERA_PERMISSION_REVOKED`, startup→`CAMERA_UNAVAILABLE`, mid-run→`CAMERA_TRACK_ENDED`; single-success-frame recovery closes episodes; pause drops stale frames; stop closes + flushes; single in-flight flush; heartbeats piggyback every batch + standalone when idle |
| Episode tracker (§10.3, §11, §17) | `services/proctoring/episodeTracker.ts` (pure) — debounce/hysteresis from the FROZEN policy, cooldown merge (re-entry merges into the previous episode; finished episodes held for the cooldown window before emission), confidence handling (median quality floor for face-present episodes; detection-channel-health confidence + sanitized-fraction guard for absence), **§17.5 precedence** (face episodes suppressed while a technical condition is open), dark-feed hysteresis (enter <15 luma, clear <25), frozen-feed stasis (8 identical frame signatures), closeAll |
| Event buffer (§23) | `services/proctoring/eventBuffer.ts` — FIFO with monotonic `clientSeq` + client-generated idempotency keys, AsyncStorage persistence per attempt (survives relaunch), cap 500 dropping oldest with an honest `bufferOverflow` envelope counter, take/ack split (failed sends stay queued), reset on session-closed |
| Detector boundary | `services/proctoring/detector.ts` — `createProctoringFrameDetector()` (raw Tier A binding; the Phase 2 swap-only-the-factory seam); pure `failureClassifier.ts` keeps the engine expo-free |
| Native detector output | `modules/proctoring-spike/.../ProctoringSpikeModule.kt` — adds `meanLuma` (Rec.601 mean of the downscaled analysis bitmap, computed after the timed stages) + `faceCount` passthrough in `classifyFrame`; additive, compile-verified under New Architecture |
| React glue + UI | `hooks/useProctoringSession.ts` (one engine per attempt+session, AppState pause/resume, session resync for the frozen policy, teardown on unmount); `components/proctoring/ProctoringBanner.tsx` (technical-status banner, §20.4 client step); `components/proctoring/ProctoringCameraPip.tsx` (student-visible PiP — the same CameraView doubles as the capture source; one camera session, nothing recorded); `taking.tsx` integration (proctored attempts only); `utils/proctoringCopy.ts` monitoring copy (D7); `QuizContext` carries `proctoringSessionId`/`proctoringPolicy`/`proctoringArm` |

### 39.2 Event behavior summary (as implemented)

- Face events: `FACE_NOT_DETECTED` (sustained ≥ `facePresence.minAbsentMs` frozen at start),
  `FACE_PARTIALLY_VISIBLE` (clipped, 10 s provisional), `FACE_OUT_OF_FRAME` (mapped from the
  classifier's `small` visibility — reason `face_too_small`), `MULTIPLE_FACES_DETECTED`
  (≥ `multipleFaces.minDurationMs`, peak count + median confidence). One episode per sustained
  interval; transient losses, single frames and blips produce nothing; recovery closes the episode
  and the timeline keeps both halves.
- Camera health: `CAMERA_UNAVAILABLE` / `CAMERA_PERMISSION_REVOKED` / `CAMERA_TRACK_ENDED` /
  `MODEL_UNAVAILABLE` (3-consecutive-failure debounce, engine side) + `CAMERA_FEED_DARK`
  (luma hysteresis) + `CAMERA_FEED_FROZEN` (result-stasis heuristic — provisional `basis:
  'result_stasis'`, technical events only). All technical, all quiz-continuing (§20.4 ladder's
  warn/submit steps are Phase 6 policy).
- Transport: batches ≤ 50 events, per-event idempotency keys, `serverAt` authoritative ordering,
  out-of-order/delayed batches accepted, duplicates answered `duplicate`, 400 drops the batch
  client-side (permanent), 429/network retried on the next heartbeat, 409 winds the engine down.
- Heartbeat: every batch piggybacks; standalone empty batch when idle; `lastSeenAt` +
  set-once frozen-policy parameters on the session. **A health signal, never an honesty claim**
  (§16.1). Gap episodes/DEGRADED transitions are Phase 4.
- Head orientation: the detector exposes Euler angles and the frame observation carries them, but
  **no HEAD_POSE/ATTENTION episodes are derived** — Phase 5, and only under a validated detector
  (D6 record-only regardless).

### 39.3 Deviations and reviewed decisions

1. **Phase 0 gate honored, not bypassed.** Tier A is wired through the Phase 2 factory seam and
   every rollout gate stays OFF; the analysis pacing default is a deliberately conservative
   4 000 ms snapshot interval (the only measured frame cost to date — capture ~830 ms + inference
   ~195 ms — caps the snapshot transport below 1 fps on that device). The streaming-transport
   decision (report §29.1) and the measured device floor remain pending the runbook. No accuracy
   or performance claims are made anywhere.
2. **`meanLuma`/`faceCount` added to the spike native module** (not a new module): the module IS
   the Tier A detector binding Phase 2 already reuses; a second native module would fork the
   detector. Additive fields; compile-verified; spike screen/engine untouched.
3. **Frozen-feed detection is a provisional result-stasis heuristic** (8 identical sanitized
   frame signatures) because the validated detector surface provides no frame hash; it is a
   technical event (review context only). A proper image-hash signal arrives with the Phase 3
   transport decision if the runbook requires it.
4. **Buffer overflow is an envelope counter, not a `BUFFER_OVERFLOW` event** — the event registry
   is enum-locked by design, so the marker cannot exist as an event; the honest count rides the
   batch envelope and is logged server-side for delivery-reliability metrics.
5. **No strict `EVENT_SEQ_REJECTED`**: §7.3/§23 require accepting out-of-order and delayed
   batches; the envelope only checks internal consistency (seq == last event's clientSeq).
   Ordering authority is `serverAt` (tested).
6. **Cooldown-held emission**: finished episodes are held `cooldownMs` (10 s default) before
   transport so a re-entry can merge; emission is therefore batched, never per-frame. `durationMs`
   is included in metadata AND stored server-side.
7. **`bufferOverflow` drops oldest-first** (not "oldest lowest-severity"): severity is a
   server-owned field the client must not assert (§24.1); age is the only honest client-side
   ordering.
8. **App-lifecycle pause covers Android `background` only** (iOS additionally `inactive`); the
   Android `inactive` state is transient (permission dialogs) and must not pause analysis.
   Integrity-event emission for backgrounding is Phase 4, unchanged.
9. **Legacy `POST .../tab-switch` untouched** — its dual-write wrapping is Phase 4 scope (§27.5).

### 39.4 Tests performed

| Suite | Result |
|---|---|
| `backend/tests/unit/proctoring/eventIngest.test.js` (envelope matrix, server-owned shaping, forged ownership, flood boundaries) | 13 passed |
| `backend/tests/integration/proctoring/proctoringEvents.test.js` (ingest happy path incl. frozen-policy heartbeat params, duplicate replay no-op, out-of-order acceptance, forged server-field stripping, type/confidence/timestamp/batch-size rejections, SESSION_MISMATCH, cross-user + wrong-quiz 404s, non-proctored 400, post-submit 409 + batchesRejected, past-deadline lazy finalize → auto_submitted + session CLOSED, flood flag at cap, rate limit 429, session GET access matrix, GET /attempt/:id hint) | 22 passed |
| Root jest `proctoringEpisodeTracker.test.ts` (presence/multiple/visibility/confidence/malformed/signals/dark/frozen/cooldown/precedence/closeAll) | 19 passed |
| Root jest `proctoringEventBuffer.test.ts` (ordering, take/ack, cap/overflow, persistence round-trip, reset) | 5 passed |
| Root jest `proctoringEngine.test.ts` (SESSION_STARTED/RESUMED, duplicate-start no-op, absence episode + recovery, multiple-faces episode, camera failure taxonomy + recovery, retry/permanent-drop/session-closed transport, idle heartbeat, pause/resume stale-frame drop, stop close-flush) | 15 passed |
| Full root jest suite (regression gate) | 11 suites, 130/130 passed |
| Full backend suite (regression gate) | **722/723 passed** — the single failure is the pre-existing `excelParser` whitespace-QUESTION_TYPE test documented in §38.3 (fails on the clean tree too; unrelated to proctoring). Every proctoring + quiz-flow suite green |
| `tsc -p tsconfig.proctoring.json` + `tsconfig.spike.json` (now includes engine/tracker/buffer/hook/components/taking) | 0 errors |
| ESLint on all changed client files | 0 errors (pre-existing warnings unchanged) |
| `gradlew :proctoring-spike:compileDebugKotlin` (luma addition, New Architecture) | BUILD SUCCESSFUL |

### 39.5 Remaining blockers / pending device validation

- **Phase 0 on-device runbook** (report Appendix C): the detector tier verdict, the measured
  device floor, sustained-FPS/thermal numbers and the ≥95% scenario classification — Phase 3 AC 1,
  5 and the device half of AC 7 (precheck floor refusal) cannot be claimed until it runs.
- **Transport decision** (snapshot vs CameraX ImageAnalysis/VisionCamera) uses the runbook's
  split timings; until then the engine runs the conservative snapshot pipeline.
- **Real-device pass** of the full taking-screen flow (PiP + banner + engine lifecycle on a dev
  build) is required before any rollout gate advances (§31 Stage 1).

### 39.6 What is deliberately NOT here (later phases, per §32)

Focus/integrity signals (`APP_BACKGROUND` etc.), benign-interruption grace, screen-capture
prevention, heartbeat gap episodes + DEGRADED transitions (Phase 4) · head-pose/attention
episodes, baseline capture (Phase 5) · rules engine, risk scoring, warnings, auto-submit
(Phase 6) · timelines/analytics/review (Phase 7). Attention remains record-only and contributes
zero risk (D6); no `CHEATING`-family identifier exists anywhere (registry test-enforced).

---

## 40. Phase 4 Implementation Record (2026-09-16)

Phase 4 (§32) is **implemented and verified by automated tests**: focus/integrity signals
(`APP_BACKGROUND`, `EXIT_ATTEMPTED`), §20.5 benign-interruption grace/tolerance, attempt-scoped
screen-capture prevention (D13), heartbeat-gap episodes with DEGRADED→ACTIVE transitions, and the
legacy tab-switch dual-write hardening (§27.5). All rollout gates remain OFF. Nothing here warns,
creates violations, or auto-submits — that is the Phase 6 rules engine. Non-proctored quizzes are
unchanged except the explicitly approved legacy-route hardening (§40.2.3).

### 40.1 What was implemented

| Area | Files |
|---|---|
| Heartbeat-gap pure helpers (§16.2/§7.4) | `backend/utils/proctoring/sessionHealth.js` (NEW) — `computeHeartbeatGap` (null `lastSeenAt` → startup grace §16.3; ≤ timeout → temporary transport gap, never degradation; deterministic key `hbgap:{session}:{lastSeenAt}`), `buildGapEventRecord` (server-generated `HEARTBEAT_GAP`, source `system`, reuses `buildEventRecord`), `buildGapTransitions` (ACTIVE→DEGRADED at `lastSeenAt+timeoutMs`, DEGRADED→ACTIVE at contact — honest timestamps under the lazy doctrine) |
| Gap wiring + deterrence stamping | `backend/routes/proctoringEvents.js` — gap computed from the PRE-UPDATE `lastSeenAt` inside the existing heartbeat bookkeeping (after all gates, before the session update); gap insert via `insertMany` + E11000-as-duplicate (only the insert winner pushes transitions + `$inc sessionHealth.missedIntervals`/`integrity.heartbeatsMissed` + `$push integrity.unmonitoredIntervals{cause:'heartbeat_gap'}`); `SESSION_STARTED`/`RESUMED` metadata `screenCapturePrevention` (enum-validated, set-once) stamps `session.deterrence` |
| Legacy tab-switch hardening (§27.5) | `backend/routes/quizzes.js` tab-switch route — gains `tabSwitchRateLimit`, lazy §7.5 duration sync (the answer-route pattern), `in_progress` status filter (400 `INVALID_ATTEMPT_STATUS`, no counter bump), and the dual-write: proctored attempts with an ACTIVE/DEGRADED session also insert one `TAB_HIDDEN` point event (`source:'browser'`, `metadata:{legacy:true}`, deterministic key `legacy-tab:{attempt}:{count}`) + `$inc eventCounts.TAB_HIDDEN`; non-proctored attempts keep the counter as their only channel |
| Rate limiter | `backend/middleware/proctoringRateLimit.js` — `tabSwitchRateLimit` + test hook, same in-memory pattern, REUSING `EVENTS_RATE_LIMIT` (60/min/student; no new threshold) |
| Focus episode formation (§14, §20.5) | `services/proctoring/focusTracker.ts` (NEW, pure) — only `'background'` opens an excursion (`'inactive'` never counts — Android permission dialogs §14.4); sub-`focusEvents.minDurationMs` (frozen 2000) blips are dropped while within tolerance (5/5 min, §20.5 illustrative constants — the `episodeTracker` hard-coding precedent); beyond tolerance they aggregate into ONE `APP_BACKGROUND {pattern:'repeated_brief', count, windowMs}`; each qualifying excursion emits exactly one duration-bearing episode; `onExitAttempted()` point event; `closeAll()` for teardown |
| Transport source fix (latent Phase 3 defect) | `services/proctoring/engine.ts` — `toWireEvent` now stamps `source` per type via `EVENT_SOURCE_BY_TYPE` mirroring the registry (`system` session events, `cv` camera/CV, `os` integrity); hand-built test payloads always included `source`, so no test caught that REAL engine batches would have been 400-rejected ("Event source is required"). Phase 4 events ride the same transport, so this was a prerequisite |
| Engine focus API + deterrence | `engine.ts` — public `recordEpisodes()` (enqueue → persist → best-effort flush; works while `paused` — a backgrounded app cannot flush by design, the episode rides the persisted buffer §23; no-op when stopped); `deterrence` option rides SESSION_STARTED/RESUMED metadata |
| Deterrence resolver + prevention hook (§15.2) | `services/proctoring/screenCapture.ts` (NEW, pure — Android→`android-flagsecure`, iOS/web→`unsupported`, disabled→`disabled`); `hooks/useAttemptScreenCapturePrevention.ts` (NEW) — imperative keyed `preventScreenCaptureAsync`/`allowScreenCaptureAsync` (expo-screen-capture ~8.0.9), armed only while the proctored session is active, released on finalize (context clears the attempt), on unmount (mid-attempt navigation), and on policy disable; web no-op; the global `_layout.tsx` block stays dead |
| Hook + screen wiring | `hooks/useProctoringSession.ts` — owns the FocusTracker beside the engine; the existing AppState listener feeds it (background opens, active closes → `recordEpisodes` → `resume`); teardown closes open excursions before `engine.stop()`; `recordExitAttempted()` on the result (gated on armed status via a status ref — enqueuing before `buffer.restore()` settles would lose the event). `taking.tsx` — mounts the prevention hook; `handleBackPress` records `EXIT_ATTEMPTED` before the existing exit Alert; the web `visibilitychange` handler is unchanged (web reaches the pipeline through the server-side dual-write) |

### 40.2 Deviations and reviewed decisions

1. **Event type naming**: the brief's "SESSION_HEALTH_GAP" is implemented as the registry's locked
   **`HEARTBEAT_GAP`** — Phase 1 enum-locked the name in the registry, model, and severity map;
   renaming would modify locked Phase 1 behavior.
2. **Every background > 90 s records BOTH `APP_BACKGROUND` and `HEARTBEAT_GAP`** (heartbeats pause
   by design while backgrounded). Spec-literal — §16.2 demands the gap record; no suppression rule
   was invented. Phase 6's rules engine reconciles interplay.
3. **Legacy-route hardening observably changes non-proctored behavior**: completed attempts now get
   400 instead of a silent counter increment, >60/min gets 429, and past-deadline attempts are
   lazily finalized (§7.5 doctrine applied to an attempt-touching route). All three are explicitly
   required by §27.5/§24.5/§7.5 and were flagged in the approved plan.
4. **§20.5 tolerance knobs (5 blips / 5 min) are client-side constants**, not policy fields — the
   frozen policy schema carries no knob for them and authoring validation rejects unknown keys;
   `episodeTracker`'s hard-coded provisional visibility floor is the precedent. Policy-driving
   them later is an additive schema change.
5. **iOS deterrence records `unsupported`**: the module documents best-effort iOS 13+ prevention,
   but it is unvalidated in this project and no screenshot listener is wired — the honest label
   for an unvalidated platform (revisit with device validation; `ios-detect-only` would imply
   detection that does not exist).
6. **No `APP_INACTIVE` emission** (§14.4: noisy, record-only; Android is the V1 surface). iOS true
   backgrounding still produces `APP_BACKGROUND` (iOS reports `'background'` for real exits).
7. **`GET .../proctoring/session` stays read-only** — gap detection rides the events POST (the
   heartbeat carrier); mutating on the resync GET would add a side effect the spec does not ask
   for. `SESSION_DEGRADED` remains an unwritten registry type (the transitions audit + gap episode
   carry §7.4; a state-marker event can ride Phase 6 if policy ever needs it).
8. **Deterrence is client-reported review context**, like precheck attestations: set-once,
   enum-validated, never policy, never client-assertable session state.

### 40.3 Tests performed

| Suite | Result |
|---|---|
| `backend/tests/unit/proctoring/sessionHealth.test.js` (NEW — startup grace, temporary-gap line, timeout boundary, key determinism/collision, record shape, transition pair, default fallback) | 7 passed |
| `backend/tests/integration/proctoring/proctoringHeartbeat.test.js` (NEW — gap + DEGRADED→ACTIVE at frozen 30000/90000 with honest `degradedAt`; record-only guarantee (attempt still `in_progress`, no `autoSubmitReason`); fresh/within-timeout no-gap; concurrent batches → exactly one gap + one transition pair; real APP_BACKGROUND/EXIT_ATTEMPTED ingest with severities; unregistered-source 400; deterrence set-once + enum + non-session-event ignored; post-finalize 409 with no gap) | 7 passed |
| `backend/tests/integration/tabSwitchLegacy.test.js` (NEW — non-proctored parity: counter-only, zero events; proctored parity: N posts → counter N AND N `TAB_HIDDEN` events AC 6; completed-attempt 400 with no bump; past-deadline lazy finalize → `auto_submitted`/`{kind:'duration'}` + session CLOSED + no dual-write; deterministic-key replay swallowed; 61st/min 429; ownership 404s) | 7 passed |
| Root jest `proctoringFocusTracker.test.ts` (NEW — one episode per qualifying excursion incl. 20-excursion run AC 1; frozen floor + default; blips dropped within tolerance AC 2; aggregation beyond tolerance + window reset/expiry AC 3; sub-2 s → no event at all; `inactive`/double-background transparency; EXIT_ATTEMPTED point; closeAll) | 12 passed |
| Root jest `proctoringScreenCapture.test.ts` (NEW — resolver matrix) | 4 passed |
| Root jest `proctoringEngine.test.ts` (+5 — per-type `source` on wire events (regression for the fix), deterrence metadata on STARTED/RESUMED, `recordEpisodes` while monitoring/paused/no-op-after-stop) | 20 passed |
| Full root jest suite (regression gate) | 15 suites, 163/163 passed |
| Full backend suite (regression gate) | **743/744** — the single failure is the pre-existing `excelParser` whitespace test (§38.3; fails on the clean tree) |
| `tsc -p tsconfig.proctoring.json` (now includes the prevention hook) + ESLint changed files | 0 errors; no new warnings |

### 40.4 Pending device validation (emulator harness, AVD TestAPI35)

The §32 Phase 4 AC halves that need a device/dev-build run (mirroring §39.5 — the Phase 0 runbook
still gates every rollout gate):

1. **AC 1 (20-excursion run)**: drive the taking screen through 20 background/foreground
   excursions ≥ 2 s (adb `input keyevent KEYCODE_HOME`/relaunch); assert exactly one
   duration-bearing `APP_BACKGROUND` episode per excursion in the session timeline, no duplicates
   or losses.
2. **AC 2 (blips + dialogs)**: sub-2 s excursions and a permission-dialog interruption (Android
   `inactive`) produce NO events; a benign-tolerance overrun aggregates per §20.5.
3. **AC 4 (prevention lifecycle)**: screenshots blocked on the proctored taking screen; recents
   preview blank; prevention RELEASED on finalize (result screen screenshot works again) and on
   mid-attempt navigation (instructions/back); NEVER active on a non-proctored quiz screen.
4. **AC 5 (device half)**: a >90 s backgrounding produces `HEARTBEAT_GAP` + the DEGRADED→ACTIVE
   transition pair on resume; `deterrence.screenCapturePrevention = 'android-flagsecure'` stamped.
5. Call-interruption row from §29.4 (incoming call backgrounds the app): qualifying duration
   records an episode; never described as or converted into a verdict.

### 40.5 Remaining blockers

None for Phase 4 code. Phase 5 (head pose / record-only attention) is next per §32; the Phase 0
on-device runbook still gates all rollout (§39.5), and every gate (kill switch · feature flag ·
quiz opt-in) remains OFF.

---

*End of plan. Revision 3 supersedes revisions 1–2 (2026-09-15). All decisions D1–D15 are applied
throughout. Phase 0 spike complete (CONDITIONAL GO — device runbook pending); Phases 1–4 + 6-core +
7-lite implemented (§37–§41). The Phase 3/4 detector and integrity surfaces are wired but NOT
production-validated; the streaming transport fix (Track 2) is the next implementation entry point
(detector validation still gates rollout).*

---

## 41. Phase 6 Core + Phase 7-lite Implementation Record (2026-09-30)

Delivered as "Track 1" of the streamlined continuation plan (this conversation): the **non-CV
proctoring core** — the missing Rules → Risk → Policy → Review layers — with ZERO dependency on
camera validation. Phases 5, 7-full, 8, 9 remain on the original rails.

### 41.1 What was implemented

| Area | Files |
|---|---|
| Rules engine (§18, §20.3) | `backend/utils/proctoring/rulesEngine.js` — pure `evaluatePolicy` over the frozen policy: the D3 ladder (warn each of first `toleratedViolations` qualifying integrity episodes → FINAL_WARN → SUBMIT), CV events warn-only (D8 gate off, structural), attention NEVER acts (D6, property-tested), legacy TAB_HIDDEN point events qualify on existence (web parity), camera revocation = one session-level violation + per-episode warn. Bounded evaluation scope (this batch's fresh events + persisted violations — never a full-session replay per batch); documented stale-low concurrency semantics (under-enforcement only, self-healing; SUBMIT is CAS-protected downstream) |
| Risk scoring (§19) | `backend/utils/proctoring/riskScore.js` — additive explainable scoring over the pre-existing `DEFAULT_RISK_WEIGHTS` (caps; attention = 0; prompt-recovery credit with sign-correct clamping; breakdown contributions sum EXACTLY to the score — test-enforced) + the threshold-free type-aggregate pipeline builder |
| Session summary (§25.2) | `backend/utils/proctoring/summary.js` — pure rollup + close-time freeze wired into `closeProctoringSessionForAttempt` (frozen at finalize for every finalize path: manual, duration, cascade, policy) |
| Ingest wiring (§27.2) | `routes/proctoringEvents.js` — post-ingest evaluation: violations upserted by deterministic `derivationKey` (new unique partial index on `ProctoringViolation` — the multikey `eventRefs` index cannot be unique), `actionTaken` stamped on triggering episodes, `WARNING_DELIVERED` system events with deterministic warnId keys (concurrent deliveries collapse), `emitToUser('proctoring_warning')` socket nudge, batch response gains `actions[]` + `riskCategory` + `attemptFinalized`/`autoSubmitted`, risk + `violationsCount` recomputed per batch (best-effort — a scoring failure never fails a batch), post-submit session state re-read |
| Policy auto-submit (§20.6) | `makePolicySubmitter` in `routes/quizzes.js` injected into the events router — executes SUBMIT through the SAME `finalizeQuizAttempt` path with `isAutoSubmit:true` + `autoSubmitReason {kind:'policy', ruleId, eventIds}`, closing enforced sections exactly like the manual whole-quiz submit; `AUTO_SUBMITTED` decision event inserted BEFORE finalize (so the frozen summary includes it); straggler batches re-check attempt/session active before acting |
| Timeline (§25.3 lite) | `GET /api/quizzes/attempt/:attemptId/proctoring/timeline` — serverAt-ordered episode rows + violations + summary (frozen copy for closed sessions, live rollup otherwise) + `autoSubmitReason`; access via `assertAttemptReadAccess` (owner/admin/assigned mentor — D14), shared with the session resync so the two can never disagree |
| Client warnings (§20.2, §9.2) | `utils/proctoringCopy.ts` warnings block (`warn.focus/final/multipleFaces/faceMissing/camera` + `autoSubmitted` notice); `useProctoringSession` gains the `onActions` transport side-channel + `proctoring_warning` socket listener → one warnId-deduped funnel (WARN auto-dismisses after 10 s, FINAL_WARN persists); `ProctoringBanner` warning variants (FINAL_WARN renders stronger + takes precedence over camera advisories); taking.tsx navigates to results with the auto-submit notice on `autoSubmitted` |
| Review UI (lite) | `AttemptDetailModal` "Proctoring timeline" section — proctored attempts only (resync hint gates it), lazy-loaded, chronological rows with plain labels + violations + risk chips |

### 41.2 Deviations and reviewed decisions

1. **Camera-loss submit step not implemented** (§20.1's strict cameraHealth row): each
   `CAMERA_PERMISSION_REVOKED` episode warns, one session-level violation records, but no
   auto-submit path exists for camera loss — a broken camera must never cost the student their
   attempt under the default policy, and no V1 quiz can configure otherwise (under-enforcement
   direction, safe; revisit only with a validated camera pipeline, Track 2+).
2. **`sessionHealth.onProlongedOutage` beyond 'record' degrades to warn-only**: the §16.3 strict
   submit variant is deliberately not wired (absence is self-limiting — the §7.5 deadline runs
   server-side). Under-enforcement, documented.
3. **Cross-type `maxViolations` submit requires an all-deterministic (focus-loss) violation mix**
   and `violationAction:'submit'`; the default `'warn'` crossing fires a single FINAL_WARN —
   suppressed when the focus ladder already delivered one this evaluation (one final warning,
   never two). Camera revocations are excluded from any submit mix.
4. **Old Phase 3 transport fixtures moved below the facePresence floor** (7 s episodes): the
   ingest-mechanics suite now never trips the rules engine; policy behavior lives in its own
   `proctoringAutoSubmit` suite.
5. **`verifyProctoringFlow.js` flips `FEATURE_AVAILABILITY.aiProctoring` in-process** (like the
   jest mocks) — no config file is modified by verification runs.

### 41.3 Verification

| Gate | Result |
|---|---|
| `rulesEngine.test.js` (ladder permutations, modes, floors, legacy point events, D6 property over all attention types × modes, D8 property over all CV types, determinism) | 24 passed |
| `riskScore.test.js` (arithmetic, caps, sign-correct recovery clamping, breakdown-sums-to-score, attention 0, bands, determinism) | 20 passed |
| `summary.test.js` (rows == summary discipline) | 7 passed |
| `proctoringAutoSubmit.test.js` (full ladder e2e, blips, replay no-re-warn, attention-only, CV-only never submits, manual-vs-policy CAS race, straggler 409, section-locked policy submit closes sections) | 7 passed |
| `proctoringTimeline.test.js` (access matrix incl. cross-mentor 403, ordered rows, frozen summary + autoSubmitReason, 400/404/null edges) | 4 passed |
| `proctoringWarnings.test.ts` (server-code mirror coverage, banned language, consent version untouched) | 5 passed |
| `backend/scripts/verifyProctoringFlow.js` (real server.js + in-memory Mongo; full lifecycle incl. precheck-fail→pass, consent gating, double-start idempotency, replay/out-of-order, the complete ladder, auto-submit, timeline, access control, duration bypass) | **27/27 checks PASS** |
| Full backend suite | **920/921** (the single failure is the pre-existing `excelParser` whitespace test, failing on the clean tree since Phase 2) |
| Full root jest + `tsc -p tsconfig.proctoring.json` + ESLint changed files | 172/172 · 0 errors · 0 new warnings |

### 41.4 Remaining

Track 2 (streaming camera transport — the actual Phase 0 FPS failure), Track 3 (device
revalidation runbook → D1 acceptance), Phase 5 (record-only attention episodes), Phase 7-full
(analytics tab, exports, review workflow, overrides), Phase 8–9. Rollout gates remain OFF.



