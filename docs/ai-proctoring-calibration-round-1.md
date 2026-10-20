# AI Proctoring — Calibration Round 1 Report

> Phase 8 WS-D (plan §19.5 / AC-4). Status: **ROUND 1 COMPLETE (synthetic replay) —
> device confirmations pending WS-G.** Recorded 2026-10-19 against the Phase 8
> working tree (Phase 7 baseline `fafddc8` + WS-A…D).

## 1. Measurement pipeline (how per-type false-positive rates will be computed)

The §19.5 step-3 formula: for each attention/head-pose event type,

```
FP rate(type) = dismissed violations of that type ÷ total violations of that type
```

computed from `ProctoringViolation.review` → `eventRefs[]` → `ProctoringEvent.type`
over the reporting window. The machinery is LIVE end to end:

- the review workflow (§25.4) writes `review.status = confirmed | dismissed |
  escalated` per violation (admin-only, closed sessions only);
- the Phase 8 observability digest (`GET /api/quizzes/proctoring-metrics/digest`,
  `backend/utils/proctoring/metricsDigest.js` dimension 1) computes exactly this
  per-type rate and renders it with its verdict.

**Today's honest value: 0 dismissed / 0 reviewed → "0/N, pipeline live."** No
production reviews exist yet (all rollout gates OFF), so NO rate is presented as
validated. A zero-data digest still renders all nine §30.2 dimensions — that is
the AC-5 property, and it is what makes this report's nulls honest rather than
missing.

## 2. Seed evidence (§45.3 supervised session, 2026-10-15)

Single-operator supervised session on the OnePlus Nord (user-driven, agent
verified from server truth):

- Spike-screen yaw mapping (anchored aiming reference): centered **−3.3°** ·
  small **−18.4°** · medium **−38.5°** · large **−57.6°** · shoulder **82–84°**
  peak.
- Tracking solid to **~58°**; flicker only **≥ ~80°**. Analysis cadence
  **~3.6 FPS**.
- Deviation pocket for the measured baseline: **measured yaw ∈ [33.4°, 50°)**
  (baseline −1.6° ⇒ deviation-active above 35°, extreme band owns ≥ 50°).
- Observed live: EXTREME ×4 and REPEATED ×3 with full provenance; normal
  behavior silent; §17.5 extreme-over-deviation precedence observed live.
  NOT observed on device (unit-locked only): the two DEVIATION_* types — the
  35–50° pocket is ~15° wide and un-rehearsed turns skip it (§45.4 records
  the anchored protocol that WS-G row 7/8 will now execute).

## 3. Retained values + rationale — NO threshold tuned in round 1

**Every value below is RETAINED-UNCHANGED.** §19.5 requires measured FP rates
from real attempts before any tuning; with gates OFF and zero production
reviews, no such measurements exist, so tuning in round 1 would be inventing
numbers. This section is the recorded tuning DECISION, satisfying AC-4's
"tuned values recorded" honestly.

Attention thresholds (exact 12-leaf mirror, client
`services/proctoring/episodeTracker.ts` `DEFAULT_ATTENTION_THRESHOLDS` ↔ server
`backend/utils/proctoring/defaults.js` `attention.thresholds`, mirror verified
per §45.4):

| Leaf | Value | Rationale (retained) |
|---|---|---|
| `turnedDeg` | 25° | Half the extreme band; conversational-turn scale from the spike |
| `extreme.yawDeg` / `extreme.pitchDeg` | 50° | Outside any screen-facing pose; tracking-solid region |
| `extreme.sustainMs` | 5 s | Filters natural orientation sweeps |
| `repeatedHeadPose` | 3 × 2 s / 5 min | Glance-pattern scale; §45.3 REPEATED ×3 observed live |
| `deviation.deg` | 35° | Sits immediately above a natural conversational turn |
| `deviation.sustainMs` | 4 s | Brief glances stay free |
| `repeatedDeviation` | 4 × 1.5 s / 5 min | One more episode than orient-away (deviation is the softer signal) |
| `fallbackPadDeg` | 10° | Pad-only-widens when no baseline was captured (D11) |

Adjacent policy floors (context): `focusEvents.minDurationMs` 2 s ·
`facePresence.minAbsentMs` 8 s · `multipleFaces.minDurationMs` 3 s.

**First tuning candidate once shadow data exists:** the 35° deviation band
(§45.3 note) — its lower edge sits directly above natural conversational
turning, and it is the band real reviews will price first. Until dismissed-rate
data exists, 35° stays.

## 4. Replay results (the calibration suite's recorded evidence)

Suite: `services/__tests__/proctoringCalibrationScenarios.test.ts` —
**14/14 PASS** (13 scenario rows + the summary-table builder). Every row is an
assertion: a red row means calibration drift. Emission counts at the CURRENT
retained thresholds (the suite's printed table, verbatim):

```
[calibration-round-1] rowId → events @ retained thresholds
n1-blink: 0 {}
n2-drift: 0 {}
n3-nodding: 0 {}
n4-brief-glance: 0 {}
n5-screen-edges: 0 {}
p1-extreme-10s: 1 {"HEAD_POSE_EXTREME":1}
p2-deviation-10s: 1 {"ATTENTION_DEVIATION_SUSTAINED":1}
a1-anchored-40deg: 1 {"ATTENTION_DEVIATION_SUSTAINED":1}
a2-anchored-45deg: 1 {"ATTENTION_DEVIATION_SUSTAINED":1}
a3-anchored-4-glances: 2 {"HEAD_POSE_REPEATED":1,"ATTENTION_DEVIATION_REPEATED":1}
a4-anchored-6-glances: 3 {"HEAD_POSE_REPEATED":2,"ATTENTION_DEVIATION_REPEATED":1}
f1-fallback-suppressed: 0 {}
f2-fallback-wider-tolerance: 1 {"ATTENTION_DEVIATION_SUSTAINED":1}
```

Reading notes (measured, not assumed):

- All five normal-behavior rows emit NOTHING — the anti-"no head movement"
  contract holds at retained thresholds.
- The anchored glances (rows a3/a4, 40° held 2.5 s, baseline −1.6°) complete
  BOTH pattern windows: the deviation window (4 × 1.5 s) AND the orient-away
  window (3 × 2 s) — the same physical glances legitimately produce both
  record-only types. This dual emission is a calibration observation for the
  shadow-data round: if real reviews dismiss one type but confirm the other,
  the two windows are the first place to look.
- Band-edge rows (33/35/49/51° at the §45.3 baseline) are regression-locked in
  `proctoringAttentionTracker.test.ts` (~lines 478-507) — cited, not duplicated.

## 5. Not measurable now

- **Supervised agreement** (detector vs. human labels): only capturable in
  spike fixtures (§45.3); no production labeling channel exists by design.
- **App performance** (fps/CPU/mem of the detector): the client sends no such
  telemetry — V1.1-b instrumentation trigger.
- **Crash rate**: no crash/ANR signal is persisted; proxies only
  (SESSION_RESUMED, unmonitoredIntervals) — see digest dimension 6.
- **Delivery reliability**: not captured BY DESIGN (§23 — bufferOverflow is
  logged, never stored).

## 6. Device confirmations (WS-G, 2026-10-20, OnePlus Nord)

The anchored protocol ran on device with a live-readout rehearsal first
(spike screen: 7.4–7.6 fps, ~1,300 practice frames, seated baseline −2.7° to
−3.1° — within half a degree of the §45.3 baseline).

- **ATTENTION_DEVIATION_REPEATED: CONFIRMED ON DEVICE ×2.** Captured during
  the live-readout rehearsal glances (the monitoring kept watching under the
  stacked route) and again from in/out pocket transitions. The §45.3 device
  gap for this type is closed.
- **ATTENTION_DEVIATION_SUSTAINED: NOT CAPTURED on device.** Seven
  calibrated hold attempts bracketed both pocket edges — turns landed
  repeatedly under 35° or at ≥50° (HEAD_POSE_EXTREME ×4 and
  FACE_PARTIALLY_VISIBLE ×2 fired around the edges; §17.5 precedence
  observed live every time). The ~15° pocket is humanly hard to hit blind
  even after live-readout calibration — this is the quantified form of the
  §45.3 aiming-error lesson and direct supporting evidence for the 35°
  band's tuning candidacy once shadow data exists. The mechanism itself is
  locked synthetically (suite rows a1/a2); a future session pairing the
  live readout with a single immediate hold remains the way to close it.
- Incidental: the full focus ladder (WARN×3 → FINAL_WARN → policy SUBMIT,
  `focus.maxViolations`) and the complete heartbeat outage→recovery cycle
  were both captured live during the same session (§47.3).
