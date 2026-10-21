# AI Proctoring — Phase 9 Rollout Plan (Rev 3 — Single-Tester Scope)

## Status

- **Status: REV 3 (2026-10-21) — execution focuses EXCLUSIVELY on the product
  owner's personal end-to-end testing.** The app has not officially launched;
  the owner is the only tester. **No student cohort rollout, no app-store
  publishing, and no general release preparation belong to the current
  execution** — all of that is Future work (§H).
- **Rev 3 changes:** cohort phase removed from execution (was Rev 2 Phase
  C-1); kill-switch operator fix IMPLEMENTED LOCALLY + tested (§C, not
  deployed); quiz-level toggle design documented and AWAITING APPROVAL (§D);
  interruption-safety matrix added (§E); single-tester runbook rewritten with
  prerequisites/stop conditions (§F); production-risk assessment added (§G).
- **Standing rule (§31):** every activation step is an explicit owner
  decision, never automatic, never skipped. Nothing is enabled in production
  by this document.
- **Source of truth:** `docs/ai-proctoring-implementation-plan.md` §31, §47;
  this file for Phase 9 execution.

## A. Where things stand — five categories, with evidence

### A1. Completed AND verified (evidence in hand)

| Item | Evidence |
|---|---|
| Proctoring stack implemented (app screens, engine, events, heartbeat, resume, analytics, review, overrides, digest) | Phase 8 record §47; code inventory re-walked 2026-10-21 |
| Backend test suites green at `94eac9f` (87 suites / 1201 tests incl. security + AC-3 e2e; root 24/292; verify script 52/52; strict tsc) | §47 / WS-F-I records |
| §31 semantics tested: kill switch/flag OFF → quiz stays unproctored; precheck 503; in-flight immune; non-proctored quizzes unchanged | `proctoringFoundation.test.js:257,269`; `proctoringLifecycle.test.js:235,513`; `proctoringSecurity.test.js:201` |
| Deployed Render backend contains the proctoring code; freeze deployed there; health green | Read-only probes 2026-10-21: digest + precheck routes → 401 unauth; `GET /api/settings` → 503; `/api/health` → 200 |
| Release builds auto-target the production backend (`.env` ignored in release) | `services/config.ts:26-27` (`!__DEV__` → hardcoded prod host) |
| **Test APK built** (v1.1.0 / versionCode 12, `internal` profile, release mode, no store submission) | EAS build finished 2026-10-21: `https://expo.dev/artifacts/eas/VxQGlke96Cd9O8tq48vkYcPpGHzfuSsBhvSljU7U938.apk` |
| Kill-switch operator fix implemented locally + new test suite | §C (featureAvailability.js allowlist + `settingsProctoringKillSwitch.test.js`; 34/34 with featureGate + signupToggle suites, 2026-10-21) |

### A2. Completed locally, NOT deployed (needs owner commit + Render deploy)

- The kill-switch allowlist fix (§C) — in the working tree, uncommitted.
- app.json (1.1.0 / versionCode 12) + eas.json (`internal` profile) — in the
  working tree, uncommitted.
- The eventual `aiProctoring: true` flag flip — NOT made; happens (if ever)
  only as part of the owner-approved activation sequence (§F).

### A3. Implemented but still requiring investigation/testing (code exists ≠ works)

- Complete proctoring flow ON THE APK against production (precheck → consent
  → monitored taking → submit → analytics) — no proctored session has ever
  run on production; §F verifies it stepwise.
- Kill-switch API behavior on the DEPLOYED backend (route exists there; the
  allowlist fix is local-only until deployed).
- Daily digest email delivery (code + timer verified; never sent — no
  recipients configured).
- Exact deployed Render commit (probes prove route presence, not the commit;
  confirm on the Render dashboard — likely auto-deploy of `94eac9f`).

### A4. Requires the owner's explicit approval (hard boundaries)

Deploying anything to Render · flipping any production flag/kill switch ·
arming any quiz · creating any production account · setting digest
recipients · implementing the quiz-level toggle (§D) · any store submission.

### A5. Future work — outside current execution (§H)

Student cohort rollout · store publication · Stage 3+ (warning mode) ·
min-version gate · threshold tuning · V1.1-b instrumentation.

## B. Ground truth (verified 2026-10-21 — re-verify on execution)

1. **Gates, all OFF:** `backend/config/featureAvailability.js`
   `aiProctoring: false` · `client/src/config/features.ts` false · app
   `utils/featureAvailability.ts` false · AppSettings `proctoringEnabled`
   default false (fail-closed; `models/AppSettings.js:27`). Precedence
   kill-switch > flag > quiz opt-in lives in ONE helper
   (`utils/proctoring/rollout.js`) shared by /start and precheck/consent.
   Blocker codes: `quiz_config_disabled`, `global_kill_switch_off`,
   `feature_flag_off` (`policySnapshot.js:45-49`).
2. **Server-driven client flow:** quiz list carries `proctoringRequired`
   (`routes/quizzes.js:3239`); `instructions.tsx:112` routes to precheck →
   consent → monitored taking. App-side `aiProctoring` flag has zero
   quiz-flow consumers.
3. **Release channel:** no EAS Update; release builds hardcode the production
   API host (`services/config.ts`). No store release will be made in Phase 9.
4. **Kill-switch operator surface — CORRECTED 2026-10-21:** the settings
   router has NO `PUT /`; toggles are per-field admin routes:
   `PUT /signup-enabled`, `PUT /proctoring-enabled` (the kill switch),
   `PUT /proctoring-strict-cv`, `GET /` (admin read), `GET /public`. (Rev 2's
   proposal to allowlist `PUT /` was therefore wrong; §C contains the
   verified fix.)
5. **Shadow mode = quiz authoring:** ALL policies `record`
   (`rulesEngine.js:172` — timeline only, not counted, not warned),
   `camera: 'optional'` → precheck records `cameraBypassed` and proceeds
   (`precheckReport.js:221`). Attention record-only regardless (D6).
6. **Cohort targeting server-enforced:** precheck/consent → 403
   NOT_ASSIGNED; `assignedStudents` explicit list; avoid
   `assignToAllFreeUsers`.
7. **Authoring API accepts proctoring today (admin-only):**
   `POST /quizzes/create-from-bank` (`routes/quizzes.js:961`, validation at
   :999) and `PUT /quizzes/:id` (:1783, validation at :1853; absent payload
   PRESERVES stored config; provided payload fully replaces; explicit clear
   disables for future attempts). `parseProctoringConfig` rejects unknown
   keys / out-of-range / attention escalation / riskWeight injection.
   **Admin UI (create-quiz.tsx / edit-quiz.tsx) has ZERO proctoring
   references — the opt-in is API-only today (§D).**
8. **Production DB:** Atlas `test`; the LOCAL backend shares it — any local
   script with `backend/.env` writes production data (treat accordingly).
9. **Digest (from code, `utils/proctoring/metricsDigest.js:379-394` +
   `server.js:348-357`):** `PROCTORING_DIGEST_RECIPIENTS` =
   comma-separated emails (split on `,`, trimmed, empties dropped); no
   recipients → one log line, no email (dormant by design);
   `PROCTORING_DIGEST_DISABLED=1` removes the 24 h timer entirely; first run
   24 h after boot (restart loops cannot email-storm); failures logged,
   never thrown; window = last 24 h per run.

## C. Emergency kill switch — problem, local fix, verification

### C.1 What blocked it (verified trace)

Request path: `PUT /api/settings/proctoring-enabled` →
`server.js:419 app.use('/api/settings', featureGate('userManagement',
'settings'), settingsRoutes)` → `featureGate` reads
`FEATURE_AVAILABILITY.userManagement === false` (freeze ON) → checks
`QUIZ_WORKFLOW_ALLOWLIST.settings` = only `'GET /public'` → no match →
**503 FEATURE_DISABLED before the router (and thus before auth, validation,
and the DB) ever runs.** The route itself was never broken — it is
admin-authorized, per-field, strictly boolean-validated. Result: the kill
switch could only be operated by editing the production DB — unacceptable for
an emergency control (§31).

### C.2 The local fix (smallest safe change — in working tree, NOT deployed)

`backend/config/featureAvailability.js`, settings allowlist:

```js
settings: [
  'GET /public',            // login screen signUpEnabled probe (fail-closed)
  'GET /',                  // admin read-only state (who changed what, when)
  'PUT /proctoring-enabled' // the kill switch itself
],
```

Narrowness properties (each proven by a test, C.4):

- Settings routes are already per-field → allowlisting one path cannot make
  the other toggles (sign-up, strict-CV) writable; they stay 503.
- No broad `PUT /` exists to expose; no authorization change (route keeps
  `authorize('admin')`); validation unchanged (strict boolean, else 400).
- A smuggled `signUpEnabled: true` inside the kill-switch body is ignored
  (route reads only `proctoringEnabled`).

Fail-safe behavior (verified in code): reads fail closed — missing document
or DB error reads OFF (`utils/appSettings.js:49-56`); writes are atomic
upserts on a singleton; a DB outage during a write → 500 (logged), state
unchanged; gate order means auth (401) still precedes nothing — the gate runs
first, so unauthenticated calls now pass the gate and get **401 from auth**,
which is correct and tested.

### C.3 Kill-switch BEHAVIOR when flipped (traced + tested — not assumed)

- Kill switch OFF (or flag OFF): precheck/consent → 503 PROCTORING_DISABLED;
  **/start treats the quiz as non-proctored** → normal attempt, old-app
  students un-stuck instantly (`rollout.js` + `/start` eligibility path).
- In-flight attempts immune: frozen `proctoringSnapshot`
  (`routes/quizzes.js:1851`); events ingest has NO kill-switch check →
  reporting + submission continue; resume never re-gates (`startGating.js`).
- Existing automated proof: `proctoringSecurity.test.js:201` ("kill switch
  closed mid-attempt: new-session surfaces 503, in-flight delivery and
  historical reads continue"), `proctoringFoundation.test.js:257,269`,
  `proctoringLifecycle.test.js:235,513`.
- Quiz answers/attempts/submissions are separate endpoints untouched by the
  switch — no corruption path exists (same suites).

### C.4 New automated tests (added 2026-10-21)

`backend/tests/integration/settingsProctoringKillSwitch.test.js` — mounts the
settings router behind the REAL featureGate exactly like server.js, then:
fail-closed read (no doc → OFF) · unauthenticated → 401 (not 503) ·
student/mentor → 403 with no state change · admin toggles on/off with echo +
`isProctoringEnabled()` agreement + `updatedBy` stamp · non-boolean bodies →
400 VALIDATION_ERROR, no change · smuggled `signUpEnabled` ignored ·
`PUT /signup-enabled` and `PUT /proctoring-strict-cv` still 503.
**Run results (2026-10-21, `--runInBand`): 3 suites / 34 tests, all passed
(this suite + featureGate.test.js + signupToggle.test.js, 161 s). The
proctoring semantics suites (proctoringSecurity, proctoringFoundation) were
re-run as regression — result recorded in the session report.**

### C.5 Deployment procedure (DOCUMENTED ONLY — not executed; owner approval required)

1. Owner reviews + commits: `featureAvailability.js` (allowlist) +
   `settingsProctoringKillSwitch.test.js` (+ the app.json/eas.json build
   files if desired). **Do NOT bundle the `aiProctoring` flag flip into this
   commit** — keep the emergency control deploy separate from any activation.
2. Render: confirm whether the service auto-deploys from the connected
   branch (`main`?) — uptime evidence suggests yes; check Dashboard →
   Settings → Build & Deploy → Auto-Deploy. If manual: Deploy latest commit.
3. No new env vars required for this fix.
4. Verify deployed (read-only / harmless): `GET /api/settings` without auth →
   401 (was 503 — proves the allowlist reached production);
   `PUT /api/settings/proctoring-enabled` with the owner's admin token and
   body `{ "proctoringEnabled": false }` (the CURRENT value — a no-op write)
   → 200 echoing false (proves writability without changing state).
5. Rollback if verification fails: revert the commit and redeploy; the
   allowlist is additive — reverting restores the pre-fix 503 with no data
   implications (nothing about this change persists anything).

### C.6 Daily digest — configuration facts (from code; nothing changed)

- Env var: `PROCTORING_DIGEST_RECIPIENTS` = comma-separated emails, e.g.
  `a@x.com, b@y.com`. Set it in Render Dashboard → Environment (a redeploy/
  restart applies it — Render applies env changes via a new deploy).
- Optional kill: `PROCTORING_DIGEST_DISABLED=1` removes the timer.
- Behavior: first digest 24 h after the env change goes live; one email per
  recipient per 24 h; skipped (log line only) while recipients are unset —
  which is the current production state.
- Safe verification: set recipients → wait/verify next daily run via server
  logs ("Proctoring metrics digest scheduled (24h)") and the arriving email;
  or verify the underlying data any time via admin
  `GET /api/quizzes/proctoring-metrics/digest?days=1` (read-only, deployed,
  currently zero-data). No restart beyond Render's env-apply is needed.

## D. Quiz-level AI Proctoring toggle — APPROVED + IMPLEMENTED (2026-10-21)

Owner approved the toggle (2026-10-21 directive) and it is implemented:

- **`utils/proctoringToggle.ts`** — the ONE shared payload module: ON sends
  the complete silent-record config (enabled + camera 'optional' + all three
  policies 'record' — never a bare `enabled:true`, which would inherit the
  schema's warn-then-submit default); OFF edits send `{enabled:false}`,
  OFF creates omit the field. Unit tests pin the shape
  (`utils/__tests__/proctoringToggle.test.ts`).
- **create-quiz.tsx** (create AND edit mode) + **edit-quiz.tsx**: an
  "Enable AI Proctoring" switch mirroring the existing toggles; loads stored
  state from `GET /quizzes/:id`; edit mode shows the amber
  "temporarily unavailable" hint from the live server eligibility.
- **Backend (one field, `routes/quizzes.js` GET /:id)**: admin-only
  `proctoringEligibility {enabled, blockers}` alongside the stored opt-in —
  the same resolver /start gates with. Students never receive it (they keep
  `proctoringRequired`).
- **Isolation suite** `backend/tests/integration/proctoring/proctoringQuizToggle.test.js`:
  OFF-create → normal quiz (ungated /start); ON-create stores exactly the
  record-mode config; bare `{enabled:true}` danger is PINNED as a documented
  decision (backend accepts it; the UI never sends it); A-on/B-off edits are
  isolated both directions; edit WITHOUT the field preserves stored config;
  student/mentor 403 on both endpoints with no state change; flag/kill-switch
  override the toggle (all four gate combinations asserted); admin GET
  carries proctoring+eligibility while students get neither field nor
  leakage; ordinary start→answer→submit→completed works after toggling OFF.
- **Ops script** `scripts/prod-proctoring-ops.js`: creds-file-based
  production operations for today's run — diagnose (deploy markers + gate
  states + flag inference), list-quizzes, quiz, kill-switch on/off, arm /
  disarm (sends the exact ON payload), student-view, digest. Credentials are
  read from `%USERPROFILE%\.eyeconic-prod-creds.json` (outside the repo) and
  never printed.

### D.1 Current support (verified)

1. Backend: YES — `Quiz.proctoring.enabled` (default false, D15 opt-in;
   `models/Quiz.js:119+`), accepted + validated on both authoring endpoints
   (`create-from-bank` :999, `PUT /:id` :1853), admin-only.
2. Admin interface: NO — zero `proctoring` references in
   `create-quiz.tsx` / `edit-quiz.tsx`. Today the opt-in is set only via
   direct API calls (scripts/curl).
3. The three-gate truth table is ALREADY the implemented behavior
   (`rollout.js` → `policySnapshot.js` blockers; tested at
   `proctoringFoundation.test.js:257,269`):

| Quiz opt-in | Feature flag | Kill switch | Actual behavior (code) |
|---|---|---|---|
| OFF | any | any | Normal quiz — no proctoring anywhere |
| ON | ON | inactive | Proctored (after precheck + consent gates) |
| ON | OFF | inactive | Unproctored — `feature_flag_off` blocker |
| ON | ON | active | Unproctored — `global_kill_switch_off` blocker |

Additional server conditions beyond the table: quiz active/not deleted,
student assigned, valid policy, consent + precheck token at /start.

### D.2 Recommended design (minimal, architecture-fitting)

- **Frontend only, mobile admin screens** (create-quiz + edit-quiz): an
  "AI Proctoring" ON/OFF switch, admin-gated screens (both call admin-only
  endpoints already).
- **ON must send the FULL shadow-safe payload, not just `enabled: true`:**
  `proctoring: { enabled: true, camera: 'optional', focusEvents: { mode:
  'record' }, multipleFaces: { mode: 'record' }, facePresence: { mode:
  'record' } }`. **Why full:** schema defaults for focusEvents are
  `'warn-then-submit'` — a bare `{enabled:true}` would arm a quiz that can
  auto-submit. The UI never sends partial configs. (This is the single most
  important safety detail of the design.)
- **OFF:** create → omit `proctoring` entirely (absent = unproctored); edit →
  send `proctoring: { enabled: false }` (explicit clear, future attempts
  only).
- **Server authority unchanged:** the toggle is a preference; the server
  re-resolves eligibility at every /start and precheck (already implemented).
  No client value is trusted (already true — `parseProctoringConfig`
  validates; eligibility is server-computed).
- **"Temporarily unavailable" state (optional, small backend addition):**
  admin quiz GET could include `proctoringEligibility: { enabled, blockers }`
  (one `resolveEligibilityForQuiz` call) so the edit screen can render
  enabled / disabled / "on, but blocked by kill switch or flag" — no student
  ever sees this (students see only the effective `proctoringRequired`).
- **No migration** needed (schema default false; legacy quizzes unaffected).
- Alternative rejected: a separate "proctoring settings" screen — more
  surface for no benefit; the toggle belongs where the quiz is authored.

### D.3 Changes required (if approved)

1. `create-quiz.tsx` + `edit-quiz.tsx`: toggle UI + payload wiring (+ copy).
2. (Optional) `routes/quizzes.js` admin GET: eligibility field.
3. Tests: (a) toggle ON arms ONLY that quiz (create a second quiz in the
   same test, assert it stays unproctored); (b) ON payload persists
   record-modes + camera optional (assert stored doc); (c) OFF/absent never
   proctors; (d) edit-toggle does not touch other quizzes' stored configs;
   (e) non-admin cannot reach the endpoints (already 403 — keep covered);
   (f) (if added) eligibility field reflects blocker codes.
4. Docs: §D recorded; quiz-authoring help copy.

### D.4 Risks

- Accidental arming of a live quiz → mitigated by the record-mode default
  payload + an explicit confirm dialog on first ON.
- Partial-payload foot-gun → the UI always sends the complete config (D.2);
  add a test asserting the exact payload shape.
- Version skew: old apps (store v1.0.3) on an armed quiz get stuck — with
  the single-tester scope this is moot until Future-work store release, but
  the toggle makes arming easier, so the confirm dialog matters.

## E. Data integrity & interruption safety (traced; automated coverage cited)

| Scenario | Behavior (code path) | Verified by |
|---|---|---|
| Camera stops working mid-quiz | Engine → `cameraIssue`; banner is DISPLAY-ONLY (`taking.tsx:1049-1052`); quiz + answers continue; camera probe failure never mislabels (`useProctoringSession.ts:317`) | engine/banner unit tests + Phase 8 device rows |
| Camera permission denied/revoked | Precheck: `camera:'optional'` → `cameraBypassed`, proceed (`precheckReport.js:221`); in-quiz revocation → cameraIssue path above | precheck unit tests |
| Network loss | Batches map to `retryable` (`useProctoringSession.ts:157-167`); events persist to AsyncStorage per-attempt buffer and flush on recovery; heartbeats gap server-side | eventBuffer/engine unit tests + heartbeat suite |
| App backgrounded | Engine pauses; APP_BACKGROUND episode recorded; closed episode rides first post-resume flush (`useProctoringSession.ts:368-392`) | focusTracker tests + Phase 8 device CONFIRMED |
| App killed / relaunch | Resume arms via session resync (`GET .../proctoring/session`); CLOSED session → routed to results; offline → arm with defaults, buffer retries (`useProctoringSession.ts:243-271`) | resume tests + device heartbeat-outage cycle CONFIRMED |
| Heartbeat failure / backend unavailable | Server `sessionHealth` marks HEARTBEAT_GAP + DEGRADED→ACTIVE recovery; answers unaffected (separate endpoints) | proctoringHeartbeat suite + device CONFIRMED |
| Kill switch activated mid-attempt | In-flight immune (frozen snapshot; events route has no switch check); submission unaffected | `proctoringSecurity.test.js:201` |
| Resume of interrupted quiz | `/start` resume never re-gates; SESSION_RESUMED + re-served baseline | lifecycle suite |
| Submit with delayed/undelivered events | `stopMonitoring`: close episodes → final flush, bounded 2.5 s, never blocks submission (`useProctoringSession.ts:405-424`); unmount teardown backstop | engine tests + §47 device |

**Honest limits (do not over-claim):**
- If the phone is OFFLINE at submit, the final event batch stays buffered;
  after the server closes the session a later flush 409s and those FINAL
  events are dropped (bounded to the last batch; monitoring records only —
  answers/results are never affected). Delivery ceiling is tracked as
  `batchesRejected` in the digest.
- Event duplication is possible on retry-after-timeout; the server collapses
  by idempotency key and reports `duplicates` (engine contract).
- None of the §F device steps below are "already proven" by the above — the
  matrix says what the CODE does; §F verifies it on the APK + production.

## F. Single-tester end-to-end test plan (the current execution)

**Stop condition (hard):** if ANY prerequisite below fails or any observed
behavior contradicts §E's traced expectations, do NOT arm the quiz; report
and stop.

### F.0 Prerequisites (all must be green before arming anything)

| # | Prerequisite | Status / how satisfied |
|---|---|---|
| 1 | APK contains the complete proctoring flow | Code-verified (§B.2, §A1); confirmed on-device in F.2 steps 1–2 |
| 2 | APK ↔ deployed backend connectivity | Release build hardcodes prod host (§B.3); F.2 step 1 proves it live |
| 3 | Backend endpoints available + auth | Probed 2026-10-21 (§A1); re-probe on the day |
| 4 | Emergency kill switch operable + safe | LOCAL fix + tests done (§C); **requires deploy (approval)** before arming |
| 5 | Quiz-level opt-in support | API-only path READY (§B.7); UI toggle is optional (§D, awaiting approval — not needed for this test) |
| 6 | Data integrity under interruption | Traced + automated coverage (§E); device-verified in F.4 |
| 7–10 | Precheck/consent, camera+events, heartbeat/resume, answers+submit | Verified inside F.3/F.4 |
| 11 | Admin review + analytics | Exists (Phase 7); verified in F.5 |
| 12 | Production risks understood | §G |

### F.1 Test account (owner-controlled; NO production account creation without approval)

**Resolved 2026-10-21:** the owner authorized using existing accounts ONLY —
admin `admin@neet.com`, students `student@neet.com` / `priya@neet.com`,
mentor `mentor@neet.com`. No accounts will be created. `student@neet.com` is
the sanctioned test account. Credentials enter the workflow solely through
`%USERPROFILE%\.eyeconic-prod-creds.json` (outside the repo; never printed,
logged, or committed) via `scripts/prod-proctoring-ops.js`.

### F.2 Phase 1 — install + baseline (COMPLETED 2026-10-21)

The owner installed the internal APK (v1.1.0/code 12) and completed a normal
quiz end-to-end on production: submission + student/admin result viewing
worked. **AI Proctoring correctly did not appear — that is the designed OFF
state, not a malfunction:** `proctoringRequired` is true only when kill
switch AND backend flag AND quiz opt-in are ALL true, and all three were
false (kill switch defaults false; the deployed backend flag is false; no
quiz is opted in). Root cause confirmed by code (`rollout.js`,
`routes/quizzes.js:3239`) and by production probes; the live gate states are
re-verified from server truth by `prod-proctoring-ops.js diagnose` before any
activation (F.3 step 0).

### F.3 Phase 2 — arm the ONE selected quiz (each step = owner approval; 2026-10-21 authorization covers all of these)

0. `node scripts/prod-proctoring-ops.js diagnose` — verify the three gates
   from server truth and that the deploy landed (deploy markers). This is
   the recorded root-cause evidence for F.2.
1. Owner commits + pushes (3 commits: kill-switch fix / toggle work /
   flag flip — revert granularity; Render auto-deploy assumed, verified by
   the marker flip in step 0's probe: `GET /api/settings` unauth 503→401).
2. Kill switch ON: `prod-proctoring-ops.js kill-switch on` → verify echo +
   `GET /settings` true. Still nothing proctored (flag false at this point
   until the flip deploys; quiz inert).
3. Flag flip deploy (commit 3): verify `diagnose` infers flag ON and normal
   quizzes still flow; digest stays zero-data.
4. Arm the quiz: `prod-proctoring-ops.js list-quizzes` → owner picks ONE
   low-stakes quiz assigned to `student@neet.com` → `arm <id>` → script
   echoes the stored config (record modes, camera optional) + eligibility
   `{enabled:true, blockers:[]}` → `student-view <id>` shows
   `proctoringRequired: true`. Rollback: `disarm <id>` (instant, future
   attempts) or `kill-switch off` (global new-session stop).

### F.4 Phase 3 — the proctored run (owner drives; agent verifies from server truth)

Happy path: precheck PASS (camera + consent screens) → consent recorded →
/start (session ACTIVE, heartbeats) → answer everything → ZERO warnings
(record mode) → submit → session CLOSED → results. Then interruptions (one
run each or combined): background/return · screen-off (heartbeat gap +
recovery) · camera cover (banner, quiz continues) · airplane burst (buffer
flush on return; submit unaffected) · kill+relaunch (resume, answers intact).
Kill-switch drill ONCE mid-attempt on the test account: PUT false → in-flight
continues + submittable, new precheck 503 → PUT true. Evidence per step:
server-side session/event/attempt state (agent), owner observation.
Any contradiction of §E → stop condition applies.

### F.5 Phase 4 — review + record

Analytics tab shows the session/episodes; `prod-proctoring-ops.js digest 1`
reflects counts; results/answers intact. Record §48 (CONFIRMED / NOT
CAPTURED discipline). Post-test state decision (owner): leave the one quiz
armed for repeat runs, or `disarm` + `kill-switch off` to return to the
all-off baseline.

### F.6 Device test 1 — evidence + verdicts (2026-10-21, priya@neet.com on Test*2)

Run: 10:44:27→10:47:51 UTC, session CLOSED, integrity clean (0 missed
heartbeats, 0 rejected batches, 0 flood flags). 8 events: SESSION_STARTED,
**5× APP_BACKGROUND** (3.3–13.8 s each — home-button tests, all recorded),
**FACE_PARTIALLY_VISIBLE 139 s + FACE_NOT_DETECTED 28 s** (camera cover —
recorded). Answers submitted, results + summary card rendered. The full
pipeline (detect → buffer → deliver → persist → summarize) is CONFIRMED on
production from server truth.

Four owner-reported issues, adjudicated on evidence:

1. **No warning on camera cover — WORKING AS DESIGNED.** All policies are
   `record` (silent shadow): `rulesEngine.js` timeline-only, never warned.
   The cover WAS detected (the face episodes above). Warnings exist only in
   warn modes; an optional warn-mode demo flip of this one quiz is available
   to the owner (see F.7).
2. **No live warning on app-return — WORKING AS DESIGNED (same cause).** The
   5 episodes recorded; in record mode the server emits no WARN actions, so
   no banner. (Even in warn mode the banner appears ~1–2 s AFTER return —
   the episode rides the first post-resume flush.)
3. **Head turns not recorded — WORKING AS DESIGNED (thresholds).** Ordinary
   seated head turns stay inside the extreme/deviation bands; only
   extreme/sustained/repeated deviations flag (Phase 8 device matrix). The
   CV pipeline was demonstrably alive — the SAME frames produced the face
   episodes.
4. **"Monitoring Active" greyed after section submit — REAL BUG (fixed
   same day).** Root cause: the section-submit handlers called
   `stopMonitoring()` before EVERY section submit; for intermediate sections
   the session stays ACTIVE and the screen does not remount, so the engine
   stopped permanently — sections after the first ran unmonitored, while the
   PiP caption (static copy) still read "Monitoring active". The device
   evidence hid the gap only because the run ended seconds after section 1
   (no heartbeat timeout had time to register). Fix: engine
   `flushNow()` (flush open episodes, keep the loop) +
   hook `flushMonitoring()` + all four submit paths now flush-then-submit and
   stop ONLY on finalization; the PiP caption is now status-driven
   (`statusCaptions`). Regression: `proctoringEngine.test.ts` Phase 9
   flushNow describe-block. Requires device re-test to fully confirm.

### F.7 Optional: warn-mode demo for the owner's own testing

The owner may flip Test*2 policies to warn modes (`focusEvents:
{mode:'warn-only'}` etc. — no auto-submit in warn-only) to SEE the banner
flow on their own device. One-quiz scope, owner-only. Not done unless
requested.

## G. Production-risk assessment (single tester, real backend + DB)

| Risk | Mitigation | Safe now? |
|---|---|---|
| Accidental flag/kill-switch/quiz-setting changes | Every change in §F.3 is an explicit owner-approved step; gates fail closed | Yes (nothing changes without approval) |
| Existing attempts/submissions disturbed | Proctoring touches separate collections; §31 semantics tested; kill switch never touches in-flight | Yes |
| Test data in production DB | Unavoidable and accepted: sessions/events/consent rows for the test account — clearly attributable, deletable if ever desired | Accepted (owner-aware) |
| Proctoring activated for other quizzes | Per-quiz opt-in only; assignment server-enforced; exactly one armed quiz by construction | Yes |
| Test events in production analytics | Same collections; single-account volume is negligible and labeled | Accepted |
| Camera/sensitive monitoring records | Images never leave the device (§: events/episodes only); consent recorded; test account = owner | Yes |
| APK/backend version skew | APK built from `94eac9f`+ (matches deployed within proctoring surface); re-verify deployed commit (§A3) before Phase 3 | Verify first |
| Auth/authz problems | 401/403 paths tested (§C.4); admin token flows used only by owner | Yes |
| Rollback limitations | Every step has an instant rollback (kill switch / quiz opt-in / revert commit) EXCEPT: already-written test data (harmless, attributable) and the final-event-batch limit (§E) | Documented |

## H. Future work (NOT current execution)

Store publication (owner-driven; unlocks old-app safety) · student cohort
rollout incl. the 10–30 student stage and its ≥2 weeks AND ≥50 sessions gate
· Stage 3+ (warning modes, min-version gate) · threshold tuning (V1.1-c) ·
real crash/perf/delivery instrumentation (V1.1-b) · quiz-level toggle
implementation (§D — awaiting approval; not blocked by anything technical) ·
SUSTAINED-hold device retry · digest recipients decision.

## What Phase 9 does NOT include (unchanged boundaries)

No store publishing · no cohort activation · no threshold tuning · no
attention consequences (D6) · no strict-CV (D8) · no new proctoring UI for
students · no EAS Update · no production change without explicit owner
approval.
