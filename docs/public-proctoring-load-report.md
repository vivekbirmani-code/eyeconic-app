# Public Proctoring — Synthetic Load Report (Phase 5)

First measured capacity numbers for the public-quiz proctoring SERVER
surfaces. Harness: `scripts/verify-public-proctoring-load.js` (boots the real
`server.js` + in-memory Mongo, drives complete proctored flows: gated /start
→ event batches → submit, all guests concurrent). **Scope: server only —
the CV detector runs client-side in the browser and is benchmarked by the
Phase 0 spike runbook, not here.** Machine: the owner's dev box (Windows,
single Node process) — indicative, not a production-instance benchmark.

## Runs (2026-10-24)

| Run | Guests × rounds | Integrity | start p50/p95 | events p50/p95 | submit p50/p95 | Wall | rps |
|---|---|---|---|---|---|---|---|
| Smoke | 10 × 4 | 10/10 closed, 0 dup keys | 189 / 199 ms | 148 / 178 ms | 139 / 139 ms | 2.7 s | 22 |
| **Default** | **25 × 8** | **25/25 closed, 0 dup keys** | **351 / 363 ms** | **274 / 348 ms** | **264 / 267 ms** | **4.9 s** | **51** |

Each guest: 1 gated `/start` (real signed precheck token + seeded consent),
8 event batches of 4–5 realistic episodes (TAB_HIDDEN/APP_BACKGROUND/FACE_*/
HEAD_POSE_* + SESSION_STARTED, piggybacked heartbeats), 1 submit. 1,250
events stored across 25 sessions; grading, session close, and summary freeze
all executed server-side during the run; **zero duplicate idempotency keys**.

## Reading the numbers (honest caveats)

- **Traffic compression:** a real guest sends ~2 requests/min (30 s
  heartbeats + episodes). The harness fires 10 requests per guest back to
  back — roughly a 30-min attempt's traffic compressed into seconds. At
  51 rps compressed, the steady-state production ceiling for 25 concurrent
  live attempts (~1 rps sustained) is far below anything measured here.
- **Latency includes grading/grading-adjacent work** (each events batch
  runs the rules engine + risk recompute over the session's events; submit
  runs full grading). p95 < 400 ms at 25 concurrent guests on a dev box
  leaves wide headroom for the single Render instance.
- **Heap delta (~98 MB for the default run)** includes the in-memory Mongo
  + server boot in the same process — not attributable to the proctoring
  surface alone; treat as an upper bound.
- **Not measured:** sustained multi-hour soak (thermal/GC), real network,
  Render's instance class, browser-side CPU (Phase 0 spike covers that).

## Capacity statement (bounded by evidence)

The verified statement: **25 concurrent proctored public attempts complete
with full integrity (no duplicates, all sessions closed and summarized) at
51 requests/sec compressed load on a single dev-box process, p95 ≤ 408 ms.**
Scaling beyond (100+ concurrent attempts) should be re-measured on the
production instance class before being claimed; the in-memory rate limiters
remain the known single-instance constraint (see BACKEND_GUIDE §31).

## Reproduce

```bash
node scripts/verify-public-proctoring-load.js [guests=25] [rounds=8]
```

Exit 0 = all integrity assertions passed (session counts, completed
attempts, event accounting, zero duplicate keys); any failure names the
surface and prints the offending response.
