# Quiz Deadline Enforcement — Architecture & Operations

> Implemented October 2026. Covers both critical assessment rules:
> (1) automatic submission when a timed attempt's duration expires, and
> (2) strict quiz availability-window (start/end) enforcement.

## The one formula

Every attempt — registered student or public-quiz guest, flat or
section-locked — is governed by a single effective participation deadline:

```
effectiveDeadline = min(attempt.durationDeadline, participationWindowEnd)
```

- `attempt.durationDeadline` — stored **pure** at `/start`
  (`startTime + quiz.duration`). Never pre-capped, never rewritten. Flat
  attempts only; section-locked attempts keep the
  `sectionStates[].endsAt` cascade as their section-level authority.
- `participationWindowEnd` — the **live** quiz document's window:
  `quiz.expiryDate` for registered students, `quiz.publicExpiryDate` for
  guests (public links are governed by the link's own expiry — a deliberate
  product rule, see `backend/utils/publicQuizAccess.js`). Reading it live
  means an admin shortening or extending the window mid-attempt applies
  immediately, with no attempt migration.
- A 30 s grace (`DURATION_GRACE_MS`) applies to the effective deadline for
  **in-transit tolerance**: an honest client request fired at the deadline
  but delayed in transit still lands as on-time. New **starts** get no grace
  — `/start` rejects at `expiryDate` exactly.

Boundary semantics: at `scheduledDate` the quiz opens; at/after
`expiryDate` new starts and all participation are forbidden; at/after the
effective deadline an attempt accepts no further answers and finalizes.

## Where the policy lives

`backend/utils/proctoring/durationEnforcement.js` is the single policy
module (`getEffectiveDeadline`, `isPastSubmissionWindow`, `isPastQuizWindow`,
`buildAutoSubmitReason`, `resolveSubmissionStatus`, `syncExpiredDuration`).
Reasons are machine-readable:
`{kind: 'duration' | 'quiz_window', deadline, detectedAt}` — whichever cap
was the earlier one; identical deadlines report exactly one (`duration`).

Two orchestrators run that policy for every attempt-touching request:

- `enforceAttemptDeadlines(attempt, quiz, {req})` — registered attempts
  (exported from `backend/routes/quizzes.js`).
- `enforceGuestAttemptDeadlines(attempt, quiz)` — guest attempts
  (exported from `backend/routes/public-quiz.js`).

Precedence inside both: (1) quiz window closed → whole-attempt finalize from
server-STORED answers (any enforced sections close atomically as
`auto_submitted`); (2) section cascade for section-locked attempts;
(3) flat deadline capped by the live window.

Applied at: `/start` (window gate + resume), answer save, tab-switch,
section submit, whole-quiz submit (status decided server-side — a manual
submit past the deadline lands `auto_submitted`, never `completed`), GET
`/attempt/:id` resync, guest `save-progress`/`submit`/section-submit, and
the proctoring event ingest.

## Automatic finalization without student activity

Lazy per-request enforcement (above) is the hard gate: an overdue attempt
can never be answered, whatever the client does. Finalization *materializes*
through two channels:

1. **Any touch** of the overdue attempt (its owner returns, an admin opens
   analytics that reads it, etc.) finalizes it via the same CAS path.
2. **The sweep** (`backend/utils/attemptSweep.js`) — a periodic DB-backed
   scan wired in `server.js` that finds `in_progress` attempts whose stored
   deadlines already say they are expired (flat deadline passed, quiz window
   closed, or section cascade exhausted) and runs the **same** orchestrators
   the routes use. This is what makes analytics/leaderboards correct for
   students who close the app at 11:29 and never reopen it.

Idempotency and concurrency: finalization is a Mongo CAS on
`status: 'in_progress'`. Manual submit, client-timer submit, lazy window
finalize, section cascade, proctoring policy submit and the sweep can all
race — exactly one wins; every loser converges to the finalized state
(`already_submitted` responses). A duplicate/replayed submit never modifies
the recorded result.

## Operations / deployment

The backend (`eyeconic-app-prod`, Render web service — a long-running Node
process) needs **no new infrastructure**. The sweep is a `setInterval` in
`server.js`, registered after the DB connects:

| Variable | Default | Meaning |
| --- | --- | --- |
| `QUIZ_SWEEP_INTERVAL_MS` | `60000` | Sweep cadence. |
| `QUIZ_SWEEP_DISABLED` | `0` | Set to `1` to disable the sweep (tests, incident response). |

The sweep is stateless and crash-safe: each cycle re-derives candidates from
stored deadlines, so a restart loses nothing and overlapping ticks are
skipped. Disabling it never weakens enforcement — lazy per-request checks
remain authoritative; only the *timeliness* of finalizing never-touched
attempts is affected.

No DB migration was required: `durationDeadline`/`autoSubmitReason` are
additive optional fields (`QuizAttempt` already had them; `GuestAttempt`
gained them). Pre-existing attempts enforce from the day they are touched
(no stored deadline → only the live window and section cascade apply,
exactly their historical behavior).

## Time zones & clocks

All deadlines are UTC `Date`s end to end (admin authoring sends ISO strings;
display uses `formatToIST`). Every enforcement comparison is
server-time-vs-stored-deadline; client clocks are irrelevant (countdowns are
display-only, corrected by a `serverNow` offset).
