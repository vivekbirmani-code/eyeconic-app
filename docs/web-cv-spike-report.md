# Phase 0 — Browser CV Feasibility Spike Report (Public-Quiz AI Proctoring)

| | |
|---|---|
| **Status** | HARNESS READY — device runs PENDING (owner-driven). All numbers below are placeholders until measured. |
| **Spike surface** | `/spike/proctoring` on the client dev server (dev-only route, tree-shaken from production builds — verified: zero references in the production bundle) |
| **Detector under test** | **Tier A-web** — MediaPipe Face Landmarker (`@mediapipe/tasks-vision` 1.1.1, WASM + GPU/CPU delegate, model `face_landmarker.task` float16 v1 from the MediaPipe model CDN) |
| **Source plan** | `docs/web-cv-spike-*` is the browser counterpart of the mobile `docs/phase-0-cv-spike-report.md` (same discipline: measured numbers, no invented claims, fallback ladder) |
| **Date** | Harness built 2026-10-23 |

## How to run (owner runbook)

1. `cd client && npm run dev`, open `http://localhost:5173/spike/proctoring` in the test browser.
2. For remote devices (Android/iPhone on the same LAN): expose the dev server on the LAN and open the page over **http://<lan-ip>:5173** — note that `getUserMedia` requires a secure context; a non-localhost http origin will NOT get camera access on most mobile browsers. Use one of:
   - desktop browsers (localhost is a secure context), and/or
   - `vite --host` behind a temporary HTTPS proxy, or a deployed preview of the static site.
   Record which transport was used for each device row — it affects load-time numbers, not detection quality.
3. Click **Start camera** → pick delegate → **Init detector** (records load ms) → **Start session**.
4. Stamp each scenario with the label buttons; the log records one row/second. **Export JSON log** at the end of each run and attach the numbers to this report.
5. Compare GPU vs CPU delegate on each device class (both are one click).

## Device matrix (fill in)

| Device | Browser | Delegate | Sustained FPS (10 min soak) | Median detect latency | Load time (wifi / throttled 4G) | CPU/mem observed | Verdict |
|---|---|---|---|---|---|---|---|
| Mid-range Android (e.g. OnePlus Nord) | Chrome | GPU | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| Mid-range Android | Chrome | CPU | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| Low-end Android | Chrome | GPU | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| iPhone (model/version) | Safari | GPU | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| Desktop (this machine) | Chrome/Edge | GPU | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |
| Desktop | Firefox | GPU | _pending_ | _pending_ | _pending_ | _pending_ | _pending_ |

## Scenario suite (fill in — same scenarios as the mobile spike, §C.3)

| Scenario | Expected classification | Observed (faces / pose readout) | Correct? |
|---|---|---|---|
| normal-seating | 1 face, pose near 0°, stable | _pending_ | _pending_ |
| glasses | 1 face, stable | _pending_ | _pending_ |
| dim-room | 1 face (or honest miss) | _pending_ | _pending_ |
| bright-backlight | 1 face (or honest miss) | _pending_ | _pending_ |
| face-partial | 1 face, still detected while partially visible | _pending_ | _pending_ |
| second-person | 2 faces | _pending_ | _pending_ |
| no-face | 0 faces | _pending_ | _pending_ |
| camera-covered | 0 faces | _pending_ | _pending_ |
| aim-small/medium/large/shoulder | yaw readout scales monotonically with turn angle (anchor the sign convention here, as the mobile spike did with its aiming reference) | _pending_ | _pending_ |

## Interruption drills (fill in)

| Drill | Behavior | Recovered without reload? |
|---|---|---|
| Tab switch away ≥30 s and back | loop pauses (visibility), resumes | _pending_ |
| Page refresh mid-session | session resets; detector re-inits | n/a (expected) |
| Camera unplugged / permission revoked mid-run | error surfaced; recovery on re-grant | _pending_ |
| 10-minute soak (thermal) | FPS drift / throttling observed? | _pending_ |

## Acceptance criteria (Tier A-web passes when, on the mid-range device)

- Sustained analysis ≥ 2 FPS over 10 minutes (target 3–5 FPS at 250 ms pacing).
- Bounded memory (no leak over the soak).
- Quiz-page-level UI responsiveness while the detector runs (subjective check + no tab freeze).
- Face present / absent / multiple classification correct in ≥ 95% of scenario passes.
- Head-pose readout directionally correct in ≥ 90% of aim scenarios (signs anchored via aim-* rows).
- Model + WASM load ≤ 10 s p95 on a throttled-4G profile (DevTools network throttle).
- Recovery without page reload in ≥ 4/5 induced failures.

## Fallback ladder (decides Phase 3's detector)

| Tier | Technology | Signals | Fallback position |
|---|---|---|---|
| A-web | MediaPipe Face Landmarker (this spike) | face count, head transform (yaw/pitch/roll) | Preferred — parity with the mobile ML Kit signal set |
| B-web | Presence-only detector (e.g. MediaPipe Face Detector, lighter) | face found/count/box only — attention descoped | If A fails quality but a lighter model passes |
| C-web | Camera stream + integrity signals only (no CV) | TAB_HIDDEN/WINDOW_BLUR + camera-on/off truth | Minimum viable: monitoring is honesty-based recording |
| D-web | Integrity-only (no camera) | tab/focus events only | Formal descope by product decision |

**Fallback rule:** if the preferred tier fails its acceptance numbers, drop to the next tier — never "tune later and hope."

## Known constraints to record per run

- WASM + model are loaded from CDN during the spike (~3–10 MB one-time). Production will self-host them on the static site; load-time numbers approximate but not equal the production figures.
- iOS Safari: camera requires a user gesture (the Start camera button provides it) and a secure context.
- `navigator.deviceMemory` is a coarse hint — the web device floor is capability-based (camera + detector init + FPS), per `backend/utils/proctoring/precheckReport.js` (platform 'web' passes the floor; camera checks carry the gate).

## Verdict (fill in after runs)

- _pending_ — Tier decision (A/B/C/D) + the measured web device floor for the precheck report.
