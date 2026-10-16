# AI Proctoring — Phase 8 Execution Plan
## Hardening: full test matrix, security pass, calibration round 1

> **This document is the durable, in-repo copy of an approved planning artifact. It is NOT an
> implementation record — nothing in it has been executed.**

## Status

- **Status: PLANNED — IMPLEMENTATION NOT STARTED**
- **Reason:** Deferred because of higher-priority work.
- **Scope:** AI Proctoring Phase 8 hardening (§32 of `docs/ai-proctoring-implementation-plan.md`).
- **Source:** The existing Claude plan at `~/.claude/plans/clever-enchanting-sedgewick.md`
  (that file is preserved unchanged; this document is a durable copy, not a replacement).
- **Planned:** 2026-10-16, against commit `fafddc8` (Phase 7), clean tree. Baselines at planning
  time: backend 82 suites / 1143 tests green · root 23 suites / 278 tests green ·
  `backend/scripts/verifyProctoringFlow.js` 49/49 · backend proctoring per-file counts:
  Analytics 12, Attention 7, AutoSubmit 7, Events 22, Foundation 27, Heartbeat 7, Lifecycle 32,
  Timeline 4; unit: durationEnforcement 24, eventIngest 13, eventRegistry 21, policySnapshot 31,
  precheckReport 16, riskScore 15, rulesEngine 24, sessionHealth 7, summary 6.
- **Resume protocol:** when the user says "Start implementation of AI Proctoring Phase 8 using
  the saved plan" — FIRST read this document and inspect the current repository state (do not
  assume the repository or dependencies are unchanged since planning), THEN execute the
  workstreams in the specified order (WS-A → WS-F agent-solo, WS-G device session, WS-H docs,
  WS-I final runs), verify every acceptance criterion, and report actual results and any
  limitations honestly.

## Locked planning decisions (user-approved 2026-10-16 — binding for implementation)

1. **Digest:** admin-only on-demand endpoint + dormant daily-email machinery
   (`PROCTORING_DIGEST_RECIPIENTS` opt-in, `PROCTORING_DIGEST_DISABLED=1` kill); **no new UI
   panel** (V1.1 scope).
2. **Kill switch:** flag-off blocks NEW proctored sessions (503 on precheck/consent/start) while
   preserving in-flight event delivery and historical admin reads (session/timeline/review/
   analytics) — §31 rollback safety. Lock current behavior by test + reconcile §29.2's early
   "503 everywhere" line with a bracketed note.
3. **Device testing:** ONE user-driven OnePlus Nord session (~75–90 min, tiered runbook P1→P2→P3
   with drop lines); glasses/glare row INCLUDED (user has glasses); walks-behind row marked
   **NOT CAPTURED — no second person available** (mechanism unit-locked; recorded honestly).
4. **Attention remains record-only (D6):** no consequence-behavior changes anywhere in Phase 8 —
   hardening only.
5. **No threshold tuning in calibration round 1** without real false-positive measurements:
   record every default as RETAINED-UNCHANGED with rationale; tuning waits for shadow data
   (§45.3 note: the 35° deviation band is the first tuning candidate once shadow data exists).
6. **Strict-CV rollout gates remain OFF** throughout Phase 8.

## Manual device-testing dependency (read before claiming any device result)

WS-G requires the **user physically driving the Nord**; the agent verifies only from server
truth (driver `:3101/state`, timeline endpoints, host login helper) and NEVER adb-taps a held
phone. **No device test in this plan has been performed.** Every §29.4 row must be recorded
CONFIRMED / NOT CAPTURED strictly from what actually happened during the session — never
back-filled, never claimed in advance. Until WS-G runs, the §29.4 device rows (AC-1) and the
device half of AC-3 remain open, exactly as §45.3/§45.4/§46.3 record for earlier phases.

---

## Context

Phase 7 (analytics, review workflow, exports, overrides + device visual pass) is committed as
`fafddc8`. Per `docs/ai-proctoring-implementation-plan.md` §32 (line ~2381), Phase 8 is the last
engineering phase before the Phase 9 staged rollout. Five workstreams map to the five
acceptance criteria:

| AC (§32) | Workstream |
|---|---|
| AC-1 every §29.4 row passes on every device class | WS-G device matrix (rows already unit/spike/device-validated stay cited, not re-run) |
| AC-2 security tests pass incl. duration-bypass + client-tamper | WS-B (7 of 10 cases already test-locked; gaps closed) |
| AC-3 accommodation override removes attention events, keeps the rest | WS-C (server-side jest) + WS-G row 9 (device) |
| AC-4 calibration report with measured per-type FP rates + tuned values recorded | WS-D (report + replay suite; retained values = recorded tuning decision) |
| AC-5 daily metrics digest renders all nine §30.2 dimensions | WS-A (+ WS-E verify-script check) |

Hardening only: all rollout gates OFF, attention D6-locked `record`, no consequence-path
changes anywhere.

## Ground truth (verified in code 2026-10-16 against `fafddc8` — RE-VERIFY on resume; do not assume unchanged)

- **Kill-switch:** `backend/routes/proctoring.js` gates precheck AND consent (503
  `PROCTORING_DISABLED` via `loadEligibleProctoredQuiz`, lines 61–96; comment: "nothing to
  pre-check or consent to (full rollback, plan §31)"). Events/session/timeline/review/analytics
  have NO gate — they key off `attempt.proctoringSnapshot` only. `/start` blocks new sessions
  when gates close. **The chosen semantics is already shipped; only the test + doc note are
  missing.**
- **Guest auth:** `backend/middleware/auth.js:17-19` rejects `kind === 'guest'` → 401. Mint
  precedent `backend/tests/integration/webHandoff.test.js:118`:
  `jwt.sign({ kind:'guest', guestId }, process.env.JWT_SECRET)`. No proctoring endpoint tests
  this yet.
- **Rate limiters:** `backend/middleware/proctoringRateLimit.js` in-memory Maps — precheck 10/h
  per student+quiz, events 60/min per student. Reset hooks exist; **window expiry is testable
  via `jest.spyOn(Date, 'now')`** (prune-on-access).
- **Flood:** `EVENT_FLOOD_SESSION_CAP=500`, `EVENT_BATCH_MAX_EVENTS=50`
  (`backend/utils/proctoring/defaults.js:154-155`); flagged-but-accepted at ≥500
  (`backend/utils/proctoring/eventIngest.js:150`). 10×50 batches stay under the 60/min events
  limiter. Envelope rule: `seq` (if present) must equal the LAST event's `clientSeq`
  (`eventIngest.js:75-79`); gaps between events are NOT enforced (by design).
- **Timestamps:** `serverAt` is server-authoritative; `durationMs = closedAt − openedAt` is
  client-claimed, bounded 24 h + 1 h future skew (`eventValidation.js:39-40`), and feeds focus
  qualification (`rulesEngine.js:75-80`). Back-dating within bounds CAN inflate one episode's
  duration — the honest testable property is **no-reordering, no-amplification (idempotent),
  no gate bypass**, not "ladder unaffected".
- **D6 locks:** `backend/utils/proctoring/rulesEngine.js:166-167` skips ATTENTION types;
  `riskScore.js:205-216` zero contribution. Client stops emitting under
  `attention.enabled:false` (`services/proctoring/episodeTracker.ts:312,486`, unit-locked in
  `services/__tests__/proctoringAttentionTracker.test.ts`). Server ACCEPTS stray ATTENTION_*
  under attention_disabled → stored-inert; timeline does not filter them. **Decision: keep
  stored-inert — rejecting the batch would endanger the same batch's focus events from a buggy
  client; D6 is the guarantee.**
- **Overrides:** applied at snapshot freeze only
  (`backend/utils/proctoring/policySnapshot.js:125-182`); admin CRUD `overridesRouter`
  (`backend/routes/proctoring.js:354-504`) mounted `backend/routes/quizzes.js:129` BEFORE
  `/:id` routes (`/:id/proctoring` mounts at line 126).
- **Retakes:** `/start` refuses same-quiz retakes when a completed attempt exists
  (`quizzes.js` ~3189) → **the same-student cross-attempt test needs TWO QUIZZES.**
- **Test harness:** `buildApp()`/`createUser`/`createSubject` (`backend/tests/helpers/testApp.js`),
  mongodb-memory-server db helper, featureAvailability jest.mock flag flip
  (`proctoringFoundation.test.js:13-21`), `setProctoringEnabled(true, admin.user._id)`,
  `passReport()`/`startProctoredAttempt()`/`postEvents()` + inert `episode()` factory
  (`proctoringEvents.test.js:61-145`), attention event factory (`proctoringAttention.test.js`
  ~line 204).
- **Digest precedents:** `backend/utils/proctoring/summary.js` `proctoringColumns()` defines the
  canonical cameraIncidents type list (extract as exported `CAMERA_INCIDENT_TYPES` — pure
  refactor — and import it in both places); sweep wiring `backend/server.js:329-346`
  (`QUIZ_SWEEP_DISABLED` pattern inside the connectDatabase callback; `cleanupExpiredMedia`
  24 h precedent ~line 330); mailer `backend/utils/mailer.js:561` `deliverEmail(email, subject,
  html, text, devLabel, purpose, context)`.
- **Calibration seed:** §45.3 spike-screen yaw mapping (centered −3.3° · small −18.4 · medium
  −38.5 · large −57.6 · shoulder 82–84°; tracking solid to ~58°, flicker ≥~80°; ~3.6 FPS;
  deviation pocket yaw ∈ [33.4°, 50°)); §45.4 anchored protocol (rehearse ~40–45° on the spike
  screen's live yaw readout → hold 6–8 s → SUSTAINED; 4–6 × 2–3 s glances → REPEATED).
  Driver `backend/scripts/_tmp_phase4_device_driver.js` is RAM-only — nothing persisted; one
  operator total. Device matrix reality: **Nord only** (emulator camera rig does not exist and
  is unproven; low-end device waived by product decision D1/§44).

## §30.2 data-availability verdicts (from exploration; drive the digest's honest rendering)

1. FP rate — PARTIAL (per-type via `ProctoringViolation.review` → `eventRefs[]` →
   `ProctoringEvent.type`; `ProctoringEvent.review` exists in schema but is never written —
   review decisions are per-session/per-violation).
2. Detector reliability — PARTIAL (fallback tier exists: `detectorTier`,
   `metadata.calibration`, `session.baseline.calibration`, `integrity.detectorFallback`;
   supervised agreement NOT-CAPTURABLE — spike fixtures only).
3. Camera failure — PARTIAL (CAMERA_* + SESSION_DEGRADED/MODEL_UNAVAILABLE events; precheck
   init failures log-only).
4. Event accuracy — EXISTS (`integrity.floodFlagged` + `batchesRejected`; caveat: conflates
   400-validation with 409-post-close).
5. App performance — NOT-CAPTURABLE (client sends no fps/CPU/mem; spike-only).
6. Crash rate — NOT-CAPTURABLE (proxies: SESSION_RESUMED re-arm, self-heal reasons,
   `unmonitoredIntervals`).
7. Delivery reliability — NOT-CAPTURABLE BY DESIGN (bufferOverflow logged never stored §23;
   duplicates not persisted).
8. Recovery success — EXISTS/PARTIAL (HEARTBEAT_GAP + `transitions[]`
   heartbeat_timeout/recovered; camera re-acquire inferred-only).
9. Auto-submit correctness — EXISTS (AUTO_SUBMITTED events + `QuizAttempt.autoSubmitReason` +
   review join).

## §29.7 coverage map (exploration result)

COVERED already (do not duplicate — cite): (1) forged/cross-student events (ownership 404/403 +
server-owned-field stripping); (2) riskScore/violation tampering (12 SERVER_OWNED_FIELDS
stripped); (3) timestamp forgery implausible cases + serverAt ordering (residual below);
(4) timing-manipulation deadline bypass (`quizDuration.test.js` §7.5 tests 1–7 + lazy-finalize
409); (5) consent/precheck token replay (forged/expired/cross-student/cross-quiz/stale-hash +
direct-/start bypass); (8) rate limits 429 (residual below); (10) mentor D14 scoping
(timeline/resync/analytics 403s).

Gaps closed by WS-B: (a) guest token-kind confusion on proctoring endpoints; (b) kill-switch
semantics lock on non-precheck surfaces; (c) deliberate clientSeq-gap flood; (d) rate-limiter
isolation + window recovery; (e) same-student cross-attempt (two quizzes); (f) plausible
back-dating (no-reorder/no-amplify/no-bypass properties).

---

# Workstreams (execute in order A → F agent-solo, G device session, H docs, I final runs)

## WS-A — Observability digest (§30.2, AC-5)

**New `backend/utils/proctoring/metricsDigest.js`** (sibling of summary.js). Exports:

- `DIGEST_DIMENSIONS` — ordered nine keys: falsePositiveRate, detectorReliability,
  cameraFailureRate, eventAccuracy, appPerformance, crashRate, deliveryReliability,
  recoverySuccess, autoSubmitCorrectness.
- `buildProctoringMetricsDigest({ from, to })` — window aggregation over `ProctoringSession`
  (startedAt, status, baseline.calibration, integrity, eventCounts, violationsCount, review,
  transitions, sessionHealth) + `ProctoringEvent.aggregate` group-by-type on serverAt +
  `ProctoringViolation` (countedAt ≥ from, `review`, `eventRefs` → ONE `ProctoringEvent.find`
  for types). Every dimension returns `{ verdict: 'measured'|'partial'|'not_captured', value,
  basis, note }`:
  1. **falsePositiveRate** — per-type dismissed/total via Violation.review → eventRefs →
     Event.type; 0 reviews → rate null, note "pipeline live, 0/N" (partial). Basis quotes
     §19.5 step 3.
  2. **detectorReliability** — fallback rate (baseline.calibration === 'fallback' OR
     integrity.detectorFallback) ÷ sessions; supervisedAgreement sub-field not_captured with
     note pointing at §45.3 spike evidence (partial).
  3. **cameraFailureRate** — sum of `CAMERA_INCIDENT_TYPES` (imported from summary.js) ÷
     sessions; note: precheck init failures are log-only (partial).
  4. **eventAccuracy** — floodFlagged sessions + summed `integrity.batchesRejected` per 1000
     events; caveat baked in: batchesRejected conflates 400-validation with 409-post-close
     (measured).
  5. **appPerformance** — not_captured ("requires client instrumentation, V1.1"); config
     context only, labeled configuration-not-measurement (detectorTier distribution, distinct
     SESSION_STARTED `metadata.analysisIntervalMs`).
  6. **crashRate** — not_captured (no crash/ANR signal exists); proxy context (SESSION_RESUMED
     count, unmonitoredIntervals total) with explicit "proxies, not crash rates" note.
  7. **deliveryReliability** — not_captured BY DESIGN (bufferOverflow logged never stored §23;
     batch retries idempotent no-ops; duplicates not persisted; pointer to logger call sites in
     `backend/routes/proctoringEvents.js` ~357–363).
  8. **recoverySuccess** — HEARTBEAT_GAP count + recovered pairs from `transitions[]`
     (heartbeat_timeout→recovered) ÷ gaps; camera re-acquire documented inferred-only (partial).
  9. **autoSubmitCorrectness** — AUTO_SUBMITTED events → owning sessions' review.status +
     attempts' `autoSubmitReason.kind` distribution; upheldRate = confirmed/(confirmed +
     dismissed) among reviewed auto-submitted sessions; 0/0 → null with note (measured).
  Plus totals { sessions, events, violations, autoSubmits } + window { from, to }. **A
  zero-data digest still carries all nine keys — that IS the AC-5 property.**
- `renderDigestText(digest)` / `renderDigestHtml(digest)` — nine sections, each label +
  verdict + value + one-line basis; plain D7 tone; no invented numbers.
- `sendProctoringMetricsDigest({ now } = {})` — recipients from
  `process.env.PROCTORING_DIGEST_RECIPIENTS` (comma-separated emails); empty → one
  `logger.info('Proctoring digest skipped — no recipients configured')` + `{ skipped: true }`;
  else build last-24 h digest and `deliverEmail(recipient, subject, html, text,
  'PROCTORING DIGEST', 'proctoring-digest', {})` per recipient; failures logged, never thrown.
  Subject: "Proctoring metrics digest — YYYY-MM-DD".

**Modify `backend/routes/proctoring.js`** — `digestRouter` AFTER the overrides block, same
style: `digestRouter.use(auth, authorize('admin'))`; `digestRouter.get('/', handler)` with
`?days=` (default 1, clamp 1–30) → `buildProctoringMetricsDigest` for
[startOfDay(now − (days−1) days), now]; response `{ success, digest, requestId }`; export
`module.exports.digestRouter = digestRouter`.

**Modify `backend/routes/quizzes.js`** after line ~129 (right after the overrides mount,
BEFORE the single-segment `/:id` routes):
`router.use('/proctoring-metrics', require('./proctoring').digestRouter);`

**Modify `backend/server.js`** inside the connectDatabase callback (after the sweep block
~line 346), mirroring the sweep pattern:
```js
if (process.env.PROCTORING_DIGEST_DISABLED !== '1') {
  const { sendProctoringMetricsDigest } = require('./utils/proctoring/metricsDigest');
  setInterval(sendProctoringMetricsDigest, 24 * 60 * 60 * 1000);
  logger.info('Proctoring metrics digest scheduled (24h)');
}
```
No immediate first run (avoids boot-email storms); first digest 24 h after boot and only when
recipients are configured. Interval wiring not directly tested (same as the sweep); the sender
function is unit-tested.

**Refactor `backend/utils/proctoring/summary.js`** — extract the cameraIncidents type list as
exported `CAMERA_INCIDENT_TYPES`; import in metricsDigest. No behavior change.

**Tests:**
- NEW `backend/tests/unit/proctoring/metricsDigest.test.js` — zero-data digest carries all
  nine keys with correct verdicts (not_captured for 5/6/7; partial for 1/2/3/8; measured-null
  for 4/9); `renderDigestText` contains all nine labels; no recipients → skipped and
  deliverEmail NOT called (jest.mock on `../../utils/mailer`); with recipients → deliverEmail
  once per recipient with a nine-section body.
- NEW `backend/tests/integration/proctoring/proctoringDigest.test.js` — admin 200 with all
  nine dimension keys; mentor 403; student 403; guest token 401; unauthenticated 401;
  day-scoping (old session 3 days ago + today session; days=1 counts today only, days=3 both);
  seeded spot checks: one dismissed violation on a FACE_NOT_DETECTED event → per-type rate
  1.0; flood-flagged session → eventAccuracy.floodFlaggedSessions 1; AUTO_SUBMITTED +
  reviewed-confirmed session → upheldRate 1.0; fallback-calibration session → fallbackRate > 0.
  Standard harness; copy the seeding shape from proctoringAnalytics.test.js.

## WS-B — §29.7 security suite

**NEW `backend/tests/integration/proctoring/proctoringSecurity.test.js`** — one suite (the six
cases share flag-mock/guest-mint/seeding machinery; spreading them across six suites would
duplicate ~100 lines of seeding each). Standard harness + local helpers adapted from
proctoringEvents.test.js (`startProctoredAttempt` parameterized by student — needed for the
two-student limiter case; inert `episode()` factory; attention event factory).

1. **Guest token-kind confusion** — "rejects guest session tokens on every proctoring surface
   (401)": mint `jwt.sign({ kind: 'guest', guestId: 'g-sec' }, process.env.JWT_SECRET)`; seed
   one proctored attempt first (so 401-vs-404 ordering is unambiguous — auth runs first);
   assert 401 on: POST precheck-report; POST consent; POST events; GET session; GET timeline;
   POST review; GET + POST overrides; GET digest.
2. **Kill-switch semantics lock** — "kill switch closed mid-attempt: new-session surfaces 503,
   in-flight delivery and historical reads continue (§31)": gates ON → start a proctored
   attempt → `setProctoringEnabled(false, admin.user._id)` → fresh student's precheck-report →
   503 PROCTORING_DISABLED; fresh consent → 503; events batch to the IN-FLIGHT session → 200
   (accepted > 0); GET session → 200; GET timeline → 200; finalize (submit) → POST review →
   200; GET /analytics/test/:quizId → 200 with the proctoring block.
3. **clientSeq-gap flood** — "a deliberate clientSeq-gap flood flags at the session cap, stores
   exactly what was sent, and moves no decision": 10 batches × 50 attention-type events
   (HEAD_POSE_EXTREME, confidence 0.9, fresh idempotencyKeys per batch, valid ~2 s
   openedAt/closedAt windows) with deliberately gapped envelope seq/clientSeq (batch 1
   seq 0..49; batch 2 jumps to 999; batches 3–10 alternate gapped ranges — each envelope's seq
   equals its OWN last event's clientSeq, the only enforced rule). Assert: the batch crossing
   500 stored events returns floodFlagged: true; `session.integrity.floodFlagged === true`;
   `ProctoringEvent.countDocuments({ session }) === 500` (bounded — no inflation from gaps);
   `ProctoringViolation.countDocuments({ session }) === 0`; response actions absent/empty;
   riskBreakdown attention row points: 0 / contribution: 0 and riskScore unchanged vs before
   the flood. Attention types chosen deliberately: D6 makes "no decision impact" absolute.
4. **Rate-limiter isolation** — two tests:
   - "events rate limit isolates students: A exhausted (429) while B continues (200), and
     window expiry recovers A": student A posts 60 one-event batches → 200s; 61st → 429
     RATE_LIMITED; student B posts one batch → 200 (isolation — key is student only); then
     `jest.spyOn(Date, 'now')` advancing real now by 61_000 ms (mockRestore in afterEach) →
     A's next batch → 200 (prune-on-access expiry proven, not just reset).
   - "precheck rate limit is keyed per student+quiz: one student's 429 never blocks another":
     A posts 11 precheck reports → 11th 429; B's first report → 200.
5. **Same-student cross-attempt** — "events against an old, finalized attempt are rejected 409
   and never cross-write the live session": TWO proctored quizzes A and B, both assigned to
   the student (retakes are refused — ground truth). Start + submit A (session A CLOSED);
   start B (session B ACTIVE). Post events to A's attempt URL → 409 SESSION_NOT_ACTIVE;
   session A `integrity.batchesRejected === 1` and ZERO new events; session B eventCounts
   unchanged, zero new events. Optionally post to B's URL echoing session A's id → 403
   SESSION_MISMATCH — check first whether proctoringEvents.test.js already locks it; keep
   only if absent.
6. **Plausible back-dating** — "back-dated episode timestamps within the 24 h bound cannot
   reorder the timeline or amplify consequences": start attempt; post ONE APP_BACKGROUND with
   openedAt = session.startedAt − 30 min, closedAt = now (durationMs ~30 min, inside the
   plausibility bound; default warn-then-submit policy) → accepted. Assert: exactly ONE focus
   violation and one WARN action (no multiplication); replaying the same idempotencyKey →
   duplicate no-op, still one violation; timeline rows ordered by serverAt — the back-dated
   event sits at its RECEIPT position (assert the timeline's first event is SESSION_STARTED);
   durationMs stored as claimed (review context, documented). Sub-assert: an episode
   predating the session by > 24 h → 400 VALIDATION_ERROR (plausibility bound holds).

Risks: the 60-batch limiter test is ~65 HTTP requests — fine for supertest + memory-server;
keep batches at one event each. The Date.now spy leaks into route code (`new Date()`) —
harmless (serverAt just shifts); mockRestore regardless. Run the suite in isolation first
(full-suite parallelism flakiness precedent §46.2).

## WS-C — Accommodation overrides end-to-end, server side (§32 AC-3)

**Extend `backend/tests/integration/proctoring/proctoringAttention.test.js`** — new describe
"Phase 8 §32 AC-3 — attention_disabled accommodation end-to-end":

- Setup: admin creates an attention_disabled override via the real CRUD route
  (POST /api/quizzes/proctoring-overrides); the student passes precheck + consent; /start →
  assert response `proctoringPolicy.attention.enabled === false` (already asserted in the
  verify script; now locked in jest too).
- **"stray ATTENTION_* events under an attention_disabled snapshot are stored but provably
  inert (D6), while the focus ladder still walks"**: post a batch with all four attention
  types (confidence 0.9), then a qualifying APP_BACKGROUND series (4 × ≥2 s episodes, default
  tolerance 3 → WARN ×3 then FINAL_WARN on the 4th — ladder shape from
  proctoringAutoSubmit.test.js). Assert: attention events accepted (200, counted in response
  `accepted`) with actionTaken absent on all four; violations exist ONLY for focus.loss;
  riskBreakdown attention row points: 0 / contribution: 0; response actions contain only focus
  warns; timeline shows the attention rows as inert cv_observation (no filtering — current
  behavior, kept per the locked decision) AND the focus warnings. This is the server-side
  proof of AC-3's "removes those events [from consequence] while keeping the rest".
- One **relaxed_thresholds** round: override with `{ thresholds: { deviation: { deg: 50 } } }`
  → /start freezes the merged threshold into `proctoringPolicy.attention.thresholds` (assert) —
  closes the loop on the second reasonCode at session level.

No production-code change in this workstream. Device row for AC-3 lives in WS-G row 9.

## WS-D — Calibration round 1 (§19.5, AC-4)

1. **NEW root ts-jest suite `services/__tests__/proctoringCalibrationScenarios.test.ts`** — a
   table-driven §29.4 replay harness through `EpisodeTracker`, extending the
   frame/hold/centered/makeTracker/clock helpers of `proctoringAttentionTracker.test.ts:20-62`
   (do NOT modify that suite; define each row once in this suite's table). Each row =
   `{ id, §29.4 row name, frames-builder, expected classification }`; keep each row its own
   test so failures stay legible. Rows to encode (synthetic-frame-representable subset):
   - Normal-behavior rows (blink, drift within 25°, posture/nodding under minEpisodeMs, brief
     glance < 2 s, screen-area looks) → ZERO emissions.
   - Prolonged look-away 10 s+ → exactly one HEAD_POSE_EXTREME or (with baseline offset)
     ATTENTION_DEVIATION_SUSTAINED — record-only.
   - **§45.4 anchored protocol, replayed synthetically**: baseline `{ yaw: -1.6 }`; sustained
     poses at 40° and 45° held 6–8 s → exactly one ATTENTION_DEVIATION_SUSTAINED each; 4 and 6
     glances of 2–3 s within 5 min → exactly one ATTENTION_DEVIATION_REPEATED each, window
     consumed (a second full window required for a second event).
   - Band-edge rows (33/35/49/51°) already regression-locked — cite, do not duplicate.
   - Fallback pair: same poses WITHOUT a baseline → wider effective threshold,
     `calibration:'fallback'` marker, zero behavioral consequence.
   Purpose = MEASUREMENT ARTIFACT: on pass, the emission counts per scenario at the CURRENT
   retained thresholds are copied into the report doc. Final test builds and console.logs the
   compact summary table (one line per row: rowId → { events, types }) — jest output becomes
   the recorded evidence. Jest suite over a backend/scripts node script because EpisodeTracker
   is app-repo TypeScript a CJS script cannot import without a build step; the verify-script
   PASS/FAIL culture is honored by making every row an assertion (suite red = calibration
   drift).
2. **NEW `docs/ai-proctoring-calibration-round-1.md`** (standalone; precedent
   `docs/phase-0-cv-spike-report.md`; referenced from §47). Sections:
   - **Measurement pipeline** — how per-type FP rates are computed once real reviews exist
     (§19.5 step-3 formula; point at the digest dimension-1 implementation + the review
     workflow as the machinery; today's honest value: 0 dismissed / 0 reviewed → "0/N,
     pipeline live").
   - **Seed evidence** — the §45.3 yaw mapping table + supervised-session facts (EXTREME ×4,
     REPEATED ×3, ~3.6 FPS, tracking solid to ~58°, deviation pocket [33.4°, 50°)).
   - **Retained values + rationale** — every attention threshold leaf from
     `DEFAULT_ATTENTION_THRESHOLDS` (client, `services/proctoring/episodeTracker.ts:46-53`) /
     `attention.thresholds` (server, `backend/utils/proctoring/defaults.js:38-67` — exact
     12-leaf mirror per §45.4: turnedDeg 25 · extreme 50°/5 s · repeatedHeadPose 3×2 s/5 min ·
     deviation 35°/4 s · repeatedDeviation 4×1.5 s/5 min · fallbackPadDeg 10 · faceAbsent
     8 s · multipleFaces 3 s · focus ≥2 s) listed as **RETAINED-UNCHANGED**, quoting §45.3:
     the 35° band sits immediately above a natural conversational turn; band/pocket width is
     the first tuning candidate once shadow data exists. Explicit statement: NO threshold
     tuned in round 1 (deliberate — §19.5 requires measured FP rates from real attempts before
     tuning; none exist with gates off). This satisfies AC-4's "tuned values recorded" as a
     recorded tuning DECISION with rationale, not invented numbers.
   - **Replay results** — the calibration suite's summary table + pass counts.
   - **Not measurable now** — supervised agreement, app perf, crash rate; V1.1-b triggers.
   - **After WS-G:** device confirmations of the two anchored DEVIATION_* rows appended.

## WS-E — Verify-script extension (culture artifact)

**Modify `backend/scripts/verifyProctoringFlow.js`** — append ~3–4 checks after the overrides
block (labels verbatim):
- "proctoring metrics digest endpoint serves all nine §30.2 dimensions (admin only)" — GET
  /api/quizzes/proctoring-metrics/digest as admin → 200 with all nine dimension keys; as the
  student token → 403.
- "stray attention events under attention_disabled stay inert through the real server" — using
  the override student from the existing block: post one attention batch → 200, no actions,
  zero violations for that session (start one via the real precheck path if the override
  student has no session yet).
- LAST (cheap, and restore state immediately after): "kill switch closed mid-attempt keeps
  event delivery open" — setProctoringEnabled(false, admin._id) on a live in-flight session,
  post one batch → 200, restore true. Place it LAST so later checks never see gates off.

Expected new total ~52–53 checks (from 49). Update the file's docblock checklist. Run the
script after every insertion; keep the kill-switch check last and restore state.

## WS-F — Interim full verification (gates WS-G scheduling)

- `cd backend && npx jest` — expect ~85 suites / ~1180+ (prior 82 / 1143 + metricsDigest unit +
  integration, proctoringSecurity, the attention AC-3 block). Record exact numbers.
- Root `npx jest` — expect ~24 suites / 300+ (prior 23 / 278 + proctoringCalibrationScenarios).
- `cd backend && node scripts/verifyProctoringFlow.js` — all PASS (~52–53).
- Strict tsc over touched TS: the only new TS is the calibration suite — type-check via a TEMP
  tsconfig (NO extends — root tsc 5.3.3 chokes on expo's base config TS6046; module esnext,
  moduleResolution bundler, strict, jsx react-jsx, paths `@/*`, `files` with literal paths —
  `[id]` brackets break include globs). No production frontend file is touched in Phase 8.
- Run the new suites in isolation FIRST, then full (memory-server contention precedent §46.2).
- **STOP if any test forces a production-code change** — re-derive against the §31/§24
  doctrine before editing. The ONLY sanctioned production-code touches in Phase 8:
  `metricsDigest.js` (new), the `digestRouter` + its `quizzes.js` mount line, the `server.js`
  interval, and the `CAMERA_INCIDENT_TYPES` extraction in `summary.js` (pure refactor).

## WS-G — §29.4 device matrix + AC-3 device row (user-driven Nord; ONE ~75–90 min session)

**Harness restart recipe (this must be re-done — background tasks die with the session that
started them):**
1. IP check FIRST (drifted repeatedly: `ipconfig` PC WLAN IPv4 + `adb shell ip route`; phone
   must share the subnet); set `.env` `EXPO_PUBLIC_API_URL=http://<PC-IP>:3100/api`.
2. Driver: `cd backend && node scripts/_tmp_phase4_device_driver.js` (background; in-memory
   Mongo; tolerates :3000 busy; sidecar :3101 has /state /requests and POST /reset which
   clears attempts/sessions/events but KEEPS users+quiz). Seeded each boot: student
   `p4device@run.test` / `P4passw0rd23`, admin `p4admin@run.test` / `P4passw0rd23`, quiz
   "P4 Device Acceptance Quiz" (proctoring on, camera optional) — ids are per-boot, read from
   /state. The driver MUST flip `FEATURE_AVAILABILITY.aiProctoring = true` in-process after
   require or /start attaches no session; seed a COMPLETE profile or the post-login profile
   gate eats ~2 min.
3. Metro: `CI=1 npx expo start --dev-client --port 8081` (background). **Metro CI=1 does NOT
   watch files — restart after EVERY code edit** (restart = TaskStop, then
   `netstat -ano | grep :8081` → `taskkill //PID <pid> //F` the orphaned node, start fresh;
   healthy relaunch shows a FULL bundle ~3293 modules, a "1 module" delta = stale).
4. `adb reverse tcp:8081 tcp:8081`; phone → backend check:
   `adb shell "curl -s -m 5 -o /dev/null -w '%{http_code}' http://<PC-IP>:3100/api/health"`
   (expect 200). App reload = `adb shell am force-stop com.eyeconicbydrlalla.mentorship` +
   `monkey -p com.eyeconicbydrlalla.mentorship -c android.intent.category.LAUNCHER 1`.
5. Host login helper: TOKEN from POST /api/auth/login (admin creds above) with Bearer for
   timeline/analytics reads. **:3000 is the user's own `node server.js` — never kill it.**

**Session conduct:** the user drives the phone; the agent verifies from `:3101/state` +
timeline + login helper. NEVER adb-tap a held phone (phantom-tap trap). Screenshots are NOT
evidence (no images exist by design) — timeline + driver state are. Record per row
CONFIRMED / NOT CAPTURED, never back-filled (§45.3 style). Recording thresholds to explain to
the user BEFORE the session: app-away counts only at ≥2 s (blips <2 s free, 5 per 5 min);
attention deviation ≥35° from own baseline sustained ≥4 s (or ≥4 repeats ≥1.5 s in 5 min);
extreme pose ≥50° ≥5 s; multiple faces ≥3 s; face-absent ≥8 s; **hold any test action ≥5 s**;
sustained-attention episodes release ~11 s AFTER the student returns — wait ~15 s before
declaring "nothing fired".

**Runbook — priority tiers, execute in order, drop from the bottom of a tier when time runs
out; hard stop T+85 min. If past T+65 and P2 incomplete, skip P3 entirely (P1+P2 are
AC-critical; P2 closes the §45.3 device gap and proves AC-3 on device).**

**P1 — camera-path fairness (never yet run on device; ~30 min):**
| # | Row | Pass criteria |
|---|---|---|
| 1 | Lighting: dim → bright → backlight → warm evening | precheck guidance at worst; in-quiz advisory/degradation markers only; ZERO violations |
| 2 | Camera positions: propped left / right / high / low | baseline absorbs; zero violations |
| 3 | Distances: close / normal / far | far → precheck framing guidance; in-quiz at most FACE_PARTIALLY_VISIBLE minor |
| 4 | Camera interruption: cover lens 10 s then 35 s, recover | technical episode + §20.4 ladder (banner, re-acquire); NO violation, NO auto-submit |
| 5 | Person walks behind, <3 s, small face, ×3 | **NOT CAPTURED — no second person available** (mechanism unit-locked; recorded honestly) |
| 6 | Sustained partial face (hand on cheek / mic at mouth) 10 s+ | minor episode only; no violation |

**P2 — anchored attention protocol + accommodations (~20 min; REQUIRES rehearsing ~40–45° on
the spike screen's live yaw readout first — the §45.3 aiming-error lesson; the deviation
pocket for the measured baseline is yaw ∈ [33.4°, 50°)):**
| # | Row | Pass criteria |
|---|---|---|
| 7 | Hold the rehearsed pose 6–8 s in-quiz | exactly ONE ATTENTION_DEVIATION_SUSTAINED, record-only, basis/confidence metadata intact (releases ~11 s after return) |
| 8 | 4–6 anchored glances of 2–3 s within 5 min | exactly ONE ATTENTION_DEVIATION_REPEATED; window consumed (one extra glance alone → nothing) |
| 9 | AC-3 accommodations run: admin creates an attention_disabled override via CRUD for the run student, then a fresh proctored quiz | timeline shows ZERO attention events (client emits none); focus/multi-face rows still recorded; optional relaxed_thresholds run if time remains |

**P3 — platform/edge rows (droppable first; ~25 min):**
| # | Row | Pass criteria |
|---|---|---|
| 10 | Network interruption 30–120 s (airplane mode) | buffered events delivered after return; HEARTBEAT_GAP technical episode; DEGRADED→ACTIVE pair; NO violation |
| 11 | Sub-2 s background blips ×10 | all dropped by the floor; zero violations |
| 12 | Incoming call (accept + return, ~5–10 s) | qualifying episode per policy, warned per D3 at most — copy never says "cheating" |
| 13 | Permission-dialog backgrounding | benign grace where recoverable; per policy, never framed as cheating |
| 14 | 20-excursion focus run (§40.4 leftover) | exactly one duration-bearing episode per excursion; ladder warns; no duplicates/losses |
| 15 | Over-90 s absence (screen off) | HEARTBEAT_GAP + DEGRADED→ACTIVE transition pair with correct timing |
| 16 | Screen-capture prevention lifecycle | flagSecure active during the attempt (screenshot blocked / recents blank), released after finalize; deterrenceApplied stamped android-flagsecure |
| 17 | Glasses / glare (user has glasses — row RUNS) | normal detection; glare → suppressed CV events; zero violations |
| 18 | Fallback-calibration session (baseline-less) | CONDITIONAL — only if a baseline-less precheck is drivable on device (e.g. face lost during the face_readiness capture without failing the check). If not drivable, record honestly as unit-locked-only (§45.4 precedent) |

**Deliverable:** results table appended to §47 (WS-H) + the two anchored-protocol
confirmations appended to the calibration report.

## WS-H — Plan-doc record + reconciliations (after WS-G)

**Modify `docs/ai-proctoring-implementation-plan.md`:**
1. NEW `## 47. Phase 8 — Hardening implementation record (2026-10-…)` following the §45/§46
   style: What shipped (WS-A..E file list); Evidence (all suite counts + verify-script total +
   strict-tsc result); Device session results (§29.4 table with per-row verdicts); Deviations
   and reviewed decisions — at minimum: (i) kill-switch reconciliation vs §29.2; (ii) digest
   delivery dormant-until-recipients + the AC-5 interpretation (endpoint + renderer carry all
   nine; no new frontend surface); (iii) dimensions 5/6/7 honest not_captured, instrumentation
   deferred to V1.1; (iv) stray ATTENTION_* under attention_disabled stored-inert, not
   rejected; (v) no threshold tuning in calibration round 1 — retained values with rationale;
   (vi) device matrix = Nord only + walks-behind NOT CAPTURED. Plus an Honest limits section
   (§46.3 style).
2. Bracketed inline note at §29.2, after the proctoringFeatureGate bullet, one line:
   `[Phase 8 reconciliation: flag-off 503 applies to NEW-session surfaces (precheck/consent/
   start); in-flight event delivery and historical reads (session/timeline/review/analytics)
   deliberately continue — §31 rollback safety; locked in proctoringSecurity.test.js.]`
3. Cross-reference `docs/ai-proctoring-calibration-round-1.md` from §47 (and a single "See"
   line at §19.5).

## WS-I — Final full-suite runs (the Phase 8 gate)

Same commands as WS-F on the final tree (post-§47 edits): backend `npx jest` (record counts —
expect roughly 85 suites / 1180+ tests), root `npx jest` (~24 suites / 300+), `node
scripts/verifyProctoringFlow.js` (~52–53 PASS), strict tsc over every touched TS file via the
temp no-extends tsconfig. Record exact numbers in §47 Evidence.

## Execution order and dependencies

WS-A (digest) → WS-B (its guest/admin digest cases need WS-A merged, or drop those two cases
temporarily). WS-C (overrides e2e) and WS-D (calibration) independent of A/B — can run in any
order relative to them. WS-E after A+C. WS-F interim runs gate WS-G scheduling. WS-G device
session (user) any time after WS-F is green. WS-H doc record after WS-G. WS-I final runs
last. Everything except WS-G is single-agent executable.

## Global risks

- Full-suite runtime growth (~40 new tests incl. a 60-request limiter test and a 10×50 flood) —
  watch mongodb-memory-server contention (§46.2 transient-flake precedent); run new suites in
  isolation first, then full.
- **No production behavior change intended anywhere.** If any test forces a code fix (e.g. an
  unexpected gate), STOP and re-derive against the §31/§24 doctrine before editing. The only
  sanctioned production-code touches: `metricsDigest.js` (new), the `digestRouter` + its
  `quizzes.js` mount, the `server.js` interval, and extracting `CAMERA_INCIDENT_TYPES` in
  `summary.js` as a pure refactor.
- Zero-data honesty — every digest dimension must render its verdict even at 0/0; the
  calibration report must never present 0/N as validation; device rows are recorded only from
  what actually happened.

## Verification (how Phase 8 is proven end-to-end)

1. Per-workstream: new suites green in isolation first, then `cd backend && npx jest` full
   (~85 suites / ~1180+; known env flakes: dailyPyq + guestAttemptLead under full-suite
   parallelism — rerun solo before believing a failure).
2. Root `npx jest` (~24 suites / 300+) — includes the calibration scenario suite.
3. `cd backend && node scripts/verifyProctoringFlow.js` — ~52–53 PASS, non-zero exit on fail.
4. Strict tsc over touched TS via temp no-extends tsconfig (root tsc TS6046 workaround).
5. Digest smoke on the dev driver: `GET /api/quizzes/proctoring-metrics/digest?days=1` with
   admin token → all nine dimensions render with honest verdicts over the device-session data.
6. Device session rows recorded CONFIRMED / NOT CAPTURED from server truth (:3101/state +
   timeline), appended to §47 + the calibration report.
7. No production behavior change: only the sanctioned code touches (see Global risks).
