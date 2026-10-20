/**
 * Phase 8 WS-D — calibration round 1 replay harness (plan §19.5 / §29.4,
 * AC-4). A table-driven replay of the §29.4 behavioral rows through
 * EpisodeTracker at the CURRENT RETAINED thresholds.
 *
 * Purpose = MEASUREMENT ARTIFACT: on pass, the emission counts per scenario
 * are copied into docs/ai-proctoring-calibration-round-1.md as the recorded
 * calibration evidence. Every row is an assertion — a red row means
 * calibration drift, not a flaky test. The final test prints the compact
 * summary table; jest output is the recorded evidence.
 *
 * Band-edge rows (33/35/49/51° at the §45.3 baseline) are already
 * regression-locked in proctoringAttentionTracker.test.ts (~lines 478-507)
 * and are NOT duplicated here — cited only.
 *
 * Helpers are copied (not imported) from proctoringAttentionTracker.test.ts
 * — that suite is not modified (Phase 8 WS-D contract).
 */

import { EpisodeTracker } from '../proctoring/episodeTracker';
import type { ProctoringFrameObservation, ProctoringPolicy } from '../proctoring/types';

/** 10 fps analysis cadence — episode math stays human-readable. */
const STEP = 100;
const QUALITY = 0.9;

let clock = 0;
const frame = (
  yaw: number | null,
  pitch: number | null,
  overrides: Partial<ProctoringFrameObservation> = {}
): ProctoringFrameObservation => ({
  tsMs: (clock += STEP),
  faceCount: yaw === null && pitch === null ? 0 : 1,
  faceCountClass: yaw === null && pitch === null ? 'none' : 'one',
  visibility: yaw === null && pitch === null ? 'none' : 'ok',
  qualityProxy: QUALITY,
  largestFaceRatio: 0.35,
  meanLuma: 120,
  sanitized: false,
  headPose: yaw === null && pitch === null ? null : { yaw, pitch, roll: 0 },
  ...overrides,
});

const centered = (overrides: Partial<ProctoringFrameObservation> = {}) =>
  frame(0, 0, overrides);

/** Feeds `count` frames of one pose, returning emitted episodes. */
const hold = (tracker: EpisodeTracker, yaw: number | null, pitch: number | null, count: number) => {
  const emitted: any[] = [];
  for (let i = 0; i < count; i += 1) {
    emitted.push(...tracker.observeFrame(frame(yaw, pitch)));
  }
  return emitted;
};

const makeTracker = (policy?: ProctoringPolicy, baseline?: { yaw: number; pitch: number } | null) =>
  new EpisodeTracker({
    policy,
    ...(baseline !== undefined ? { attentionBaseline: baseline } : {}),
  });

/** Return-to-baseline tail long enough to close + clear debounce + cooldown. */
const settle = (tracker: EpisodeTracker, baselineYaw = 0) => hold(tracker, baselineYaw, 0, 130);

/** One glance: `awayMs` at `yaw`, then ≥1.2 s back at the baseline. */
const glance = (tracker: EpisodeTracker, yaw: number, awayMs: number, baselineYaw = 0) => [
  ...hold(tracker, yaw, 0, Math.round(awayMs / STEP)),
  ...hold(tracker, baselineYaw, 0, 12),
];

const ATTENTION_RE = /ATTENTION|HEAD_POSE/;
const attentionRelevant = (episodes: any[]) => episodes.filter((e) => ATTENTION_RE.test(e.type));
const typeCounts = (episodes: any[]) => {
  const counts: Record<string, number> = {};
  for (const e of episodes) counts[e.type] = (counts[e.type] || 0) + 1;
  return counts;
};

/** §45.4 anchored baseline — the supervised session's measured seated pose. */
const ANCHORED = { yaw: -1.6, pitch: 0 };

type Row = {
  id: string;
  name: string;
  /** Baseline passed to the tracker (undefined = no baseline → fallback). */
  baseline?: { yaw: number; pitch: number } | null;
  scenario: (tracker: EpisodeTracker) => any[];
  /** Expected attention-relevant emission counts at the CURRENT thresholds. */
  expected: Record<string, number>;
  extra?: (episodes: any[]) => void;
};

const ROWS: Row[] = [
  // ---------- §29.4 normal-behavior rows: ZERO emissions ----------
  {
    id: 'n1-blink',
    name: 'Blinking (quality dips, pose centered)',
    baseline: { yaw: 0, pitch: 0 },
    expected: {},
    scenario: (t) => Array.from({ length: 100 }, (_, i) =>
      t.observeFrame(centered({ qualityProxy: i % 7 === 0 ? 0.2 : QUALITY }))).flat(),
  },
  {
    id: 'n2-drift',
    name: 'Slow drift within ±25° (however long)',
    baseline: { yaw: 0, pitch: 0 },
    expected: {},
    scenario: (t) => Array.from({ length: 300 }, (_, i) =>
      t.observeFrame(frame(24 * Math.sin(i / 50), 0))).flat(),
  },
  {
    id: 'n3-nodding',
    name: 'Posture adjustments / nodding (±35° excursions under minEpisodeMs)',
    baseline: { yaw: 0, pitch: 0 },
    expected: {},
    scenario: (t) => {
      const emitted: any[] = [];
      for (let cycle = 0; cycle < 20; cycle += 1) {
        emitted.push(...hold(t, 0, 0, 10));
        emitted.push(...hold(t, 35, 0, 12)); // 1.2 s < 1.5 s min
        emitted.push(...hold(t, 0, 0, 10));
      }
      return emitted;
    },
  },
  {
    id: 'n4-brief-glance',
    name: 'Brief look-away (< 2 s)',
    baseline: { yaw: 0, pitch: 0 },
    expected: {},
    scenario: (t) => [
      ...hold(t, 0, 0, 20),
      ...hold(t, 40, 0, 14), // 1.4 s in the deviation band
      ...hold(t, 0, 0, 30),
    ],
  },
  {
    id: 'n5-screen-edges',
    name: 'Screen-area looks (sustained ±20° — inside the turned band)',
    baseline: { yaw: 0, pitch: 0 },
    expected: {},
    scenario: (t) => [
      ...hold(t, 20, 0, 100), // 10 s at 20° < turnedDeg 25
      ...settle(t),
    ],
  },
  // ---------- §29.4 prolonged look-away: exactly ONE record-only episode ----------
  {
    id: 'p1-extreme-10s',
    name: 'Prolonged look-away 10 s at 55° (absolute extreme band)',
    baseline: { yaw: 0, pitch: 0 },
    expected: { HEAD_POSE_EXTREME: 1 },
    scenario: (t) => [
      ...hold(t, 55, 0, 100),
      ...settle(t),
    ],
  },
  {
    id: 'p2-deviation-10s',
    name: 'Prolonged look-away 10 s at 45° (baseline 5° → deviation 40°)',
    baseline: { yaw: 5, pitch: 0 },
    expected: { ATTENTION_DEVIATION_SUSTAINED: 1 },
    scenario: (t) => [
      ...hold(t, 45, 0, 100),
      ...settle(t, 5),
    ],
  },
  // ---------- §45.4 anchored protocol, replayed synthetically ----------
  // Baseline {yaw:-1.6}: the deviation pocket for measured yaw is
  // [33.4°, 50°) — see proctoringAttentionTracker.test.ts ~478-507 for the
  // band-edge locks; these rows are the INTERIOR of that pocket.
  {
    id: 'a1-anchored-40deg',
    name: 'Anchored protocol: 40° held 7 s → ONE SUSTAINED (deviation 41.6°)',
    baseline: ANCHORED,
    expected: { ATTENTION_DEVIATION_SUSTAINED: 1 },
    scenario: (t) => [
      ...hold(t, 40, 0, 70),
      ...settle(t, ANCHORED.yaw),
    ],
    extra: (episodes) => {
      const sustained = episodes.find((e) => e.type === 'ATTENTION_DEVIATION_SUSTAINED');
      expect(sustained.metadata).toMatchObject({ calibration: 'captured' });
    },
  },
  {
    id: 'a2-anchored-45deg',
    name: 'Anchored protocol: 45° held 7 s → ONE SUSTAINED (deviation 46.6°)',
    baseline: ANCHORED,
    expected: { ATTENTION_DEVIATION_SUSTAINED: 1 },
    scenario: (t) => [
      ...hold(t, 45, 0, 70),
      ...settle(t, ANCHORED.yaw),
    ],
  },
  {
    id: 'a3-anchored-4-glances',
    name: 'Anchored protocol: 4 glances of 2.5 s → ONE deviation REPEATED (window consumed); the same glances also complete one orient-away REPEATED window (measured honestly)',
    baseline: ANCHORED,
    expected: { ATTENTION_DEVIATION_REPEATED: 1, HEAD_POSE_REPEATED: 1 },
    scenario: (t) => [
      ...glance(t, 40, 2500, ANCHORED.yaw),
      ...glance(t, 40, 2500, ANCHORED.yaw),
      ...glance(t, 40, 2500, ANCHORED.yaw),
      ...glance(t, 40, 2500, ANCHORED.yaw),
      // One extra glance alone: the deviation window was consumed on emit —
      // a second event requires a FULL new window of 4 (and a third
      // orient-away segment for HEAD_POSE_REPEATED's fresh window).
      ...glance(t, 40, 2500, ANCHORED.yaw),
      ...settle(t, ANCHORED.yaw),
    ],
  },
  {
    id: 'a4-anchored-6-glances',
    name: 'Anchored protocol: 6 glances of 2.5 s → still ONE deviation REPEATED (2 in the fresh window); orient-away completes its second window',
    baseline: ANCHORED,
    expected: { ATTENTION_DEVIATION_REPEATED: 1, HEAD_POSE_REPEATED: 2 },
    scenario: (t) => {
      const emitted: any[] = [];
      for (let i = 0; i < 6; i += 1) emitted.push(...glance(t, 40, 2500, ANCHORED.yaw));
      emitted.push(...settle(t, ANCHORED.yaw));
      return emitted;
    },
  },
  // ---------- §29.4 fallback pair: same poses WITHOUT a baseline ----------
  // Fallback effective deviation band = 35° + 10° pad = [45°, 50°).
  {
    id: 'f1-fallback-suppressed',
    name: '40° for 8 s WITHOUT baseline → NOTHING (40 < 45 effective)',
    baseline: null,
    expected: {},
    scenario: (t) => [
      ...hold(t, 40, 0, 80),
      ...settle(t),
    ],
  },
  {
    id: 'f2-fallback-wider-tolerance',
    name: '47° for 8 s WITHOUT baseline → ONE SUSTAINED, calibration fallback',
    baseline: null,
    expected: { ATTENTION_DEVIATION_SUSTAINED: 1 },
    scenario: (t) => [
      ...hold(t, 47, 0, 80),
      ...settle(t),
    ],
    extra: (episodes) => {
      const sustained = episodes.find((e) => e.type === 'ATTENTION_DEVIATION_SUSTAINED');
      // Record-only derivation with the honest fallback marker and the
      // PADDED threshold in the provenance — zero behavioral consequence
      // is guaranteed server-side by D6 (see proctoringAttention tests).
      expect(sustained.metadata).toMatchObject({ calibration: 'fallback' });
      expect(sustained.metadata.thresholds).toMatchObject({ deg: 45 });
    },
  },
];

// ---------- one test per row: failures stay legible ----------

describe('Phase 8 calibration round 1 — §29.4 scenario replay at retained thresholds', () => {
  for (const row of ROWS) {
    test(`${row.id}: ${row.name}`, () => {
      const tracker = makeTracker(undefined, row.baseline);
      const episodes = attentionRelevant(row.scenario(tracker));
      expect(typeCounts(episodes)).toEqual(row.expected);
      if (row.extra) row.extra(episodes);
    });
  }

  test('calibration summary table (recorded evidence for the round-1 report)', () => {
    const lines: string[] = ['[calibration-round-1] rowId → events @ retained thresholds'];
    const recorded: Record<string, { events: number; types: Record<string, number> }> = {};
    for (const row of ROWS) {
      const tracker = makeTracker(undefined, row.baseline);
      const episodes = attentionRelevant(row.scenario(tracker));
      const counts = typeCounts(episodes);
      const events = Object.values(counts).reduce((a, b) => a + b, 0);
      recorded[row.id] = { events, types: counts };
      lines.push(`${row.id}: ${events} ${JSON.stringify(counts)}`);
    }
    // The printed table IS the artifact copied into
    // docs/ai-proctoring-calibration-round-1.md — it must cover every row.
    expect(Object.keys(recorded)).toHaveLength(ROWS.length);
    // And it must agree with the per-row expectations (this test can only
    // pass when every scenario replays identically).
    for (const row of ROWS) {
      expect(recorded[row.id].types).toEqual(row.expected);
    }
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'));
  });
});
