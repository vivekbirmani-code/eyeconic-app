# Public Quiz AI Proctoring — Implementation Record

> Owner-approved plan (2026-10-23) extending AI proctoring to public quizzes
> for external students. This document records what shipped, the binding
> decisions, and the operational notes. Source of truth for status; the
> per-phase detail lives in git history and the test suites.

## Architecture (as shipped)

One proctoring system, two owner kinds:

- `ProctoringSession.ownerKind: 'user' | 'guest'` — the session's `attempt`
  anchor holds either a `QuizAttempt` id (registered students) or a
  `GuestAttempt` id (OTP-verified public leads); `student`/`guest` carry the
  owner identity. One shared event pipeline (validation → dedup → insert →
  heartbeat → rules → warnings → risk) serves both through the owner-adapter
  seam in `routes/proctoringEvents.js`.
- The three rollout gates (kill switch > feature flag > quiz opt-in) are
  shared verbatim: an armed quiz proctors BOTH internal and public attempts;
  gates off ⇒ both run unproctored (§31 semantics, test-locked).
- The web client imports the mobile engine's PURE modules (episode/focus
  trackers, event buffer, types — `services/proctoring/`) via the
  `@app-services` alias; only the capture layer is browser code (MediaPipe
  FaceLandmarker, code-split). No pixels ever leave the page on any platform.
- Public surface: `/api/public/quiz/:shareToken/proctoring/*`
  (precheck-report, consent, events, session, owner timeline) plus gated
  `/start`. Live warnings ride a dedicated guest Socket.IO lane
  (`emitToGuest`) with batch-response actions as the always-on fallback.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Browser CV spike harness + runbook | Code-complete; device-matrix runs are owner-driven (`docs/web-cv-spike-report.md`) |
| 1 | Backend foundation (owner-kind models, adapter seam, consent index split + migration) | Done — full suite green at parity |
| 2 | Public proctoring backend (gating, events, session close on every finalize path, mandatory OTP at `/start`, required-camera payloads) | Done — `proctoringPublic` suite (25 tests) |
| 3 | Web client (readiness stage, in-test engine, live warnings, tab lock, result summary card) | Done — awaiting owner browser click-through |
| 4 | Admin surfaces (guest identity in rollup + timeline, exports, share-modal indication, this doc) | Done — admin-surface describe in `proctoringPublic` (30→32 tests) |
| 5 | Hardening: security review, synthetic load, failure-matrix automation | Done — `/code-review` (7 findings, all fixed), load harness + `docs/public-proctoring-load-report.md`, revoked-link + guest auto-submit ladder tests |
| 6 | Staged rollout (backend → bundle → cache horizon → arm ONE quiz → owner E2E) | Not started |

## Binding owner decisions (2026-10-23/24)

1. **Mandatory OTP for EVERY public quiz** (armed or not). `/start` requires
   a verified lead (401 `GUEST_VERIFICATION_REQUIRED` + authoritative
   `webUrl`). Pre-policy anonymous in-progress attempts may finish (device-key
   ownership on save/submit); no new anonymous attempts.
2. **Camera REQUIRED** for newly enabled proctored quizzes (internal +
   public): `PROCTORING_ON_PAYLOAD.camera = 'required'`; a failing camera
   check blocks the precheck token. **The six quizzes armed before
   2026-10-23 keep their stored `optional` config** until explicitly
   re-armed. Reconfiguring: toggle proctoring OFF then ON in the quiz editor
   (or the ops script's arm payload) — a stored-config change alters the
   policy hash, so participants re-consent on their next start (by design).
3. **In-progress attempts always finish** — deploy-time rules never kill a
   live attempt; OTP gates `/start` only.
4. **Camera trouble mid-quiz: record + warn, never auto-submit.** Monitored
   vs interrupted attempts are distinguishable in review via session
   integrity fields. A prolonged-camera-failure policy (e.g. submit after N
   minutes) is deliberately NOT implemented; revisit as a separate decision.
5. **Retention:** "Proctoring records are kept with your test records and
   are visible only to authorized administrators." No deletion promise —
   no deletion path exists today (quiz delete is a soft delete; attempts
   and proctoring records are never removed). The deletion-cascade work is
   a deferred feature (`docs/deferred/proctoring-data-deletion-cascade.md`).
6. **Student-facing result summary card** — shipped (lightweight: status,
   violations, monitored time, review label; no admin notes/rules).
7. **Live warnings** via the guest socket lane (dual-delivery, warnId dedup);
   **external proctoring records are admin-only** (mentors never).
8. **Historical anonymous attempts keep their anonymity** — excluded from
   identity-bearing lists; labeled "Anonymous (pre-verification)" only where
   an individual row is unavoidable; identities are never invented.
9. **Consent copy** is versioned (`consentTextVersion`, currently
   `2026-11-v2-web`) and recorded against the policy hash; a POLICY change
   forces re-consent, a text-version bump alone does not (existing design).

## Consent copy (v2, web)

The notice shown before any camera access states, in plain language: the
pre-test camera readiness check; that during the test the camera is
monitored on-device for face visibility, additional people, extended
look-aways, and browser focus/tab switches; that warnings may appear; that
no photos or videos are recorded or stored; the retention sentence
(decision 5); and that the test cannot be started without agreeing and
passing the camera check. See `PublicQuizReadinessPage.tsx`.

## Operational notes

- **Deploy order (Phase 6):** backend first (inert — nothing armed for
  public), then the web bundle, wait out the static-site cache horizon, then
  arm ONE owner-selected public quiz (ops script `arm` / `arm-warn`), then
  the owner's browser E2E. Rollback: disarm the quiz (future attempts),
  kill switch (global new sessions), or revert deploys; in-flight attempts
  are immune (frozen snapshots).
- **Link revoked mid-attempt (verified contract):** monitoring events
  continue (ownership-based resolution, no link lookup); the token-based
  save/submit routes 404 (the token is unresolvable once unset); the
  deadline sweep finalizes the abandoned attempt from its stored answers
  and closes the session. An EXPIRED link (past `publicExpiryDate`, token
  still set) is the milder case: submit keeps honoring in-flight attempts
  within the grace window (existing §16 contract).
- **Mandatory OTP is a behavior change for existing links** — anyone holding
  an old link now verifies their email before starting. No link regeneration
  is needed.
- **Android app:** guest deep links render a "Verification required — Open
  in Browser" screen using the server-provided `webUrl` (old APKs degrade to
  the server's actionable 401 message).
- **Dev email:** with no SMTP/Resend configured, OTP values print in the
  backend console (never in production).
- **Known honest limits:** browser tabs throttle timers when hidden (CV
  frames naturally pause; the TAB_HIDDEN focus episode still fires via the
  visibility event); the tab lock is best-effort (two different browsers
  can still interleave — the timeline shows the interleaved truth);
  screen-capture prevention is impossible in browsers (recorded as
  `unsupported`); an offline-at-submit final batch may drop (answers are
  never affected).

## Failure-matrix verification tally (Phase 5)

The original plan's failure scenarios, each marked verified-by-automation
(test name), owner-manual (browser), or honestly not-captured:

| Scenario | Status |
|---|---|
| Camera denied before start | Automated (`proctoringPublic`: camera FAIL blocks token) + owner manual (browser prompt UX) |
| Camera disconnected mid-attempt | Automated server-side (episode ingest); engine banner = owner manual |
| Browser refresh / accidental close | Automated (resume never re-gates; buffer replay is client-side by design) + owner manual |
| Internet loss | Automated (retryable batches, out-of-order accepted, idempotency dedup) |
| Backend unavailable | Same as above (transport retryable contract) |
| Submit with events in flight | Automated (flush-then-submit contract + straggler 409) |
| Two tabs, same attempt | Automated (one live attempt; events converge) + tab lock = owner manual |
| Duplicate / delayed requests | Automated (idempotency keys, CAS finalizes, E11000 convergence) |
| Link revoked mid-attempt | Automated (`failure-matrix hardening`: events continue, save/submit 404, sweep finalizes) |
| Quiz window reached mid-attempt | Automated (lazy finalize inside events ingest + sweep suites) |
| Guest JWT expires mid-attempt | Automated (device-key ownership parity test) |
| Pre-existing public quizzes / links | Automated (unarmed quizzes unchanged; OTP mandate applies to new starts only) |
| Proctoring gates off | Automated (kill-switch/§31 suites: unproctored start, in-flight immune) |
| Missing proctoring records | Automated (self-heal + timeline null contract) |
| Guest policy auto-submit | Automated (`failure-matrix hardening`: full ladder to server-executed submit) |
| CV accuracy / FPS on real devices | **NOT CAPTURED** — Phase 0 runbook (owner device runs pending) |
| Live-warning latency in a real browser | Owner manual (socket lane is server-tested; on-device timing not measured) |

## Field-bug fix: silent analysis blindness (2026-10-24)

Owner report: deliberate head-turns during a real proctored public attempt
produced a result card of "0 recorded violations / Completed normal" with
zero monitoring events. DB evidence (session {startedAt, lastSeenAt},
heartbeats on schedule, integrity.batchesRejected 0) proved ZERO episodes
were ever enqueued client-side: the web engine ran its heartbeat/transport
loop while the per-frame analysis path was silently producing nothing. The
behavior-class (head-turn record-only + advisory warn on the 3rd marker)
was correct; the DETECTION stage was blind.

Root causes fixed (all client-side; backend contract untouched):

1. engine.ts — analysis now runs while DEGRADED (mobile parity; was:
   frozen at any degraded state with no recovery path), camera/model
   failures open tracker signals (mobile openFailureSignals parity) with
   heartbeat-driven retries of camera + detector while armed, a FRAMES
   watchdog (10s without an analyzable frame -> CAMERA_UNAVAILABLE
   reason=frames_not_flowing) and a POSE watchdog (15s of faces with no
   pose matrix -> MODEL_UNAVAILABLE reason=pose_output_missing) turn
   silent blindness into recorded technicals + degraded UI state,
   SESSION_STARTED/RESUMED is emitted BEFORE camera init (a session
   marker, not a camera-health fact), the buffer is restored BEFORE the
   first enqueue (mobile order — the old order could clobber the
   persisted queue with a one-event snapshot on refresh), every enqueue
   persists + flushes (mobile emitEpisodes parity), and now() is injected
   into both shared trackers.
2. cameraSource.ts — start() waits (bounded 5s) for the first decodable
   frame after play(); a granted-but-frameless track fails loudly as
   unavailable(frames_not_flowing) instead of analyzing nothing forever.
3. tabLock.ts — acquisitions are abortable (isCancelled): a StrictMode
   torn-down mount never claims or pings (its leaked heartbeat could make
   the live tab's lock back off -> entirely unmonitored attempt).
4. useWebProctoring.ts — the engine is created BEFORE the lock and the
   lock's onLost is bound to that specific engine instance (a stale lock
   could previously stop the live engine through the shared engineRef).
5. ProctoringSummaryCard.tsx — adds a "Monitoring events" tile
   (timeline.summary.totalEvents) so recorded observations (look-aways,
   camera incidents) are visible next to violations, and a genuinely
   clean session is distinguishable from a recording failure.

Verification: services/__tests__/webProctoringEngine.test.ts (12) +
webTabLock.test.ts (3) — sustained look-aways -> HEAD_POSE_TURNED x3 +
HEAD_POSE_REPEATED with the exact wire contract, small movements ->
nothing, frameless/pose-less/degraded/recovery/refresh paths locked.
Root suite 387/387; backend proctoring integration 186/186 (untouched);
client tsc + build clean (detector still code-split). E2E:
scripts/verify-public-proctoring-web-e2e.js boots the REAL backend
(in-memory Mongo) + REAL vite client + Chromium fake camera — before the
fix it reproduced the exact field signature (only the session marker
stored); after, the same run records the camera technicals and the card
shows the event count. Real-camera head-turn verification remains the
owner click-through (see START-HERE memory).

## Related documents

- `docs/public-proctoring-load-report.md` — Phase 5 load/capacity numbers
- `docs/web-cv-spike-report.md` — Phase 0 runbook (owner device runs pending)
- `docs/ai-proctoring-implementation-plan.md` — the internal-student program
- `docs/deferred/admin-monitoring-summary-ui.md` — deferred (explicitly NOT built)
- `docs/deferred/proctoring-data-deletion-cascade.md` — deferred
