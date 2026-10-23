# Deferred: Admin Monitoring Summary UI

**Status: DEFERRED / NOT IMPLEMENTED** (owner decision, 2026-10-23). Do not
assume this UI exists. This note exists so the feature can be reviewed and
prioritized later.

## What it would provide

An admin-facing "Monitoring Summary" surface for proctoring program health:
a dashboard rendering the nine observability dimensions the backend already
computes — false-positive rate (from review outcomes), detector reliability,
camera-failure rate, event accuracy, app performance, crash rate, delivery
reliability, recovery success, and auto-submit correctness — each with its
honest verdict (`measured` / `partial` / `not_captured`).

## Why it was deferred

The digest endpoint has existed since Phase 8 with **no UI consumer**; it is
used by automated tests and operational scripts only. Building a dashboard
would have added scope (design, screens, tests) without blocking any approved
public-proctoring capability, so the owner deferred it explicitly.

## Existing API (no changes needed when implementing)

`GET /api/quizzes/proctoring-metrics/digest?days=N` (1–30, default 1) —
admin-only; built by `backend/utils/proctoring/metricsDigest.js`
(`buildProctoringMetricsDigest`), returning `{ window, totals, dimensions }`.

The daily email digest is dormant until `PROCTORING_DIGEST_RECIPIENTS` is
set (comma-separated emails); `PROCTORING_DIGEST_DISABLED=1` removes the
24-hour timer entirely.

## Future implementation considerations

- Natural home: the existing Proctoring tab in Test Analytics
  (`student-analytics.tsx` / `ProctoringOverview.tsx`) or the admin
  dashboard — avoid a new navigation section.
- Guest sessions (`ownerKind: 'guest'`) count in the digest totals since
  Phase 2 automatically; consider an owner-kind breakdown when building.
- The dimensions' honesty verdicts are the product feature — render them
  verbatim rather than smoothing `not_captured` into zeros.
