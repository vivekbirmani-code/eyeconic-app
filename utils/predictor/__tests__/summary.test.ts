import type { BranchSummary, DesiredBranchResult, PredictionResult } from '@/types/predictor';
import {
  aboveAllClosings,
  bandCounts,
  buildDesiredShareText,
  buildShareText,
  dedupedMethodologyNotes,
  methodologyAssumptions,
  type NonCategoryBranchSummary,
} from '../summary';

const yearSummary = (
  overrides: Partial<BranchSummary['years'][number]> = {}
): BranchSummary['years'][number] => ({
  snapshotId: 'snap-1',
  year: 2025,
  state: 'MATCHED',
  counts: { total: 4, COMFORTABLE: 1, WITHIN_RANGE: 1, BORDERLINE: 1, ASPIRATIONAL: 1 },
  ...overrides,
});

const summary: NonCategoryBranchSummary = {
  stage: 'BRANCHES',
  coverage: 'MATCHED',
  category: { value: 'UR', pwd: false },
  quota: 'AIQ',
  years: [
    yearSummary(),
    yearSummary({ year: 2024, snapshotId: 'snap-2', counts: { total: 2, COMFORTABLE: 2 } }),
  ],
  dataCoverage: {
    years: [2024, 2025],
    snapshotIds: ['snap-2', 'snap-1'],
    roundConvention: 'final state (end of counselling)',
    margins: { borderline: 0.35, aspirational: 0.75, provisional: true },
  },
  notes: [],
};

const baseResult = {
  exam: 'NEET_PG',
  examLabel: 'NEET PG',
  method: {
    version: 'neetpg-branch-720-v1',
    stage: 'BRANCHES',
    assumptions: ['no-skip', 'full-length-standard-pattern', 'difficulty-parity', 'made-up-id'],
    aggregation: { method: 'mean', dedupRule: 'one per GT (latest completed attempt)' },
    widthModel: { id: 'sqrt-decay-v1', provisional: true },
    datasetSnapshots: { distribution: 'DS-1', counselling: ['C-1'] },
  },
  input: {
    gts: [],
    category: { value: 'UR', pwd: false },
    quota: 'AIQ',
    quotaLabel: 'All India Quota',
    quotaDefaulted: false,
  },
  aggregation: {
    n: 2,
    values: [120, 130],
    mean: 125,
    median: 125,
    trimmedMean: null,
    sd: 7.07,
    lowDataCaution: true,
  },
  estimate: {
    performance: {
      centerCorrects: 125,
      halfWidthCorrects: 15,
      correctsRange: [110, 140],
      scoreRange: [400, 470],
      dispersion: { sdCorrects: 7.07 },
    },
    percentile: { range: [90.1, 96.2], center: 93.5, coverage: 'full' },
    transfer: { tiers: { TIER_1: 2, TIER_2: 0 }, mixedTiers: false },
    warnings: [{ code: 'LOW_GT_COUNT', note: 'Based on few Grand Tests.' }],
    notes: [
      'Prediction assumes you attempted all questions and did not skip any questions in these Grand Tests.',
      'Engine note A',
    ],
  },
  rank: {
    rankRange: [5000, 20000],
    bestRank: 5000,
    worstRank: 20000,
    bestBeyondData: false,
    worstBeyondData: false,
    beyondLastRecordedRank: null,
    coverage: 'full',
    examYear: 2025,
  },
  branches: summary,
} as unknown as PredictionResult;

describe('bandCounts', () => {
  it('sums each band across years and totals the options', () => {
    expect(bandCounts(summary)).toEqual({
      COMFORTABLE: 3,
      WITHIN_RANGE: 1,
      BORDERLINE: 1,
      ASPIRATIONAL: 1,
      total: 6,
    });
  });
});

describe('aboveAllClosings', () => {
  it('is false when no year is above all closings', () => {
    expect(aboveAllClosings(summary)).toBe(false);
  });

  it('is true when ANY covered year sits above all closings (website parity)', () => {
    const withAbove: NonCategoryBranchSummary = {
      ...summary,
      years: [yearSummary({ aboveAllClosings: true }), yearSummary({ year: 2024 })],
    };
    expect(aboveAllClosings(withAbove)).toBe(true);
  });
});

describe('buildShareText', () => {
  it('carries the exam, ranges, GT count, disclaimer and the website link', () => {
    const text = buildShareText(baseResult);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Eyeconic Rank Predictor — NEET PG');
    expect(lines[1]).toBe('Estimated percentile: 90.1% – 96.2%');
    expect(lines[2]).toBe('Predicted AIR: 5,000 – 20,000');
    expect(lines[3]).toBe('Based on 2 Grand Tests');
    expect(lines[4]).toBe('Estimate based on historical data — actual results may vary.');
    expect(lines[5]).toBe('https://www.eyeconicneetpg.com/predictor');
  });
});

describe('dedupedMethodologyNotes', () => {
  it('drops the no-skip/disclaimer notes and exact duplicates', () => {
    const notes = dedupedMethodologyNotes({
      ...baseResult,
      estimate: {
        ...baseResult.estimate,
        warnings: [
          { code: 'LOW_GT_COUNT', note: 'Based on few Grand Tests.' },
          { code: 'X', note: 'Engine note A' },
          { code: 'Y', note: 'Crowd-sourced prior note' },
        ],
      },
      branches: {
        ...summary,
        notes: ['Estimate based on historical data. Actual exam performance and counselling outcomes may vary.'],
      },
    } as unknown as PredictionResult);

    // no-skip note (estimate.notes[0]) dropped; 'Engine note A' appears once
    // (estimate notes + warning note de-duped); disclaimer variant dropped.
    // LOW_GT_COUNT's note stays — the website shows it in Methodology too.
    expect(notes).toEqual([
      'Engine note A',
      'Based on few Grand Tests.',
      'Crowd-sourced prior note',
    ]);
  });
});

describe('methodologyAssumptions', () => {
  it('maps known assumption ids to plain language and drops unknown ids', () => {
    const assumptions = methodologyAssumptions(baseResult);
    expect(assumptions).toHaveLength(3);
    expect(assumptions[0]).toBe(
      'You attempted every question in the entered Grand Tests (none skipped).'
    );
    expect(assumptions[2]).toBe(
      'Grand Tests are treated as comparable in difficulty to the actual exam.'
    );
  });
});

// ---- Desired Branch Predictor (Phase 5 — reverse-flow share text) ----------------

const desiredBase: DesiredBranchResult = {
  exam: 'NEET_PG',
  examLabel: 'NEET PG',
  method: {
    version: 'v1',
    stage: 'REQUIRED_CORRECTS',
    assumptions: [],
    pattern: { totalQuestions: 180, positive: 4, negative: 1, maxMarks: 720 },
    datasetSnapshots: { counselling: ['snap-1'], distribution: 'dist-1', prior: null },
  },
  input: {
    branch: { key: 'md-general-medicine', display: 'MD General Medicine' },
    category: { value: 'UR', pwd: false },
    pwd: false,
    quota: 'ALL_INDIA',
    quotaLabel: 'All India Quota',
    gts: null,
  },
  target: {
    stage: 'TARGET_RANK',
    branch: { key: 'md-general-medicine', display: 'MD General Medicine' },
    category: { value: 'UR', pwd: false },
    quota: 'ALL_INDIA',
    years: [
      {
        year: 2025,
        snapshotId: 'snap-1',
        present: true,
        matched: true,
        groups: 12,
        closingMin: 9500,
        closingMax: 14200,
        tightest: { institute: 'AIIMS Delhi', closing: 9500, opening: 8000, allottedCount: 3 },
        loosest: { institute: 'Some College', closing: 14200, opening: 12000, allottedCount: 1 },
      },
    ],
    targetRankRange: [9500, 14200],
    coverage: 'MATCHED',
    variability: { tightest: 9500, loosest: 14200, ratio: 1.5, high: false },
    dataCoverage: { years: [2025], snapshotIds: ['snap-1'], roundConvention: 'final-state' },
    notes: [],
  },
  required: {
    stage: 'REQUIRED_CORRECTS',
    rule: 'round-up',
    perClosing: [
      { closing: 9500, corrects: 165, state: 'in-distribution', bounded: false },
      { closing: 14200, corrects: 152, state: 'in-distribution', bounded: false },
    ],
    notes: [],
  },
  current: {
    gts: [{ gtId: null, provenance: 'self-reported', selected: { corrects: 150, skippedCount: 0 } }],
    aggregation: {
      n: 1,
      values: [150],
      mean: 150,
      median: 150,
      trimmedMean: null,
      sd: 0,
      min: 150,
      max: 150,
      range: 0,
      lowDataCaution: true,
    },
    meanCorrects: 150,
  },
  gap: {
    status: 'BELOW_TARGET',
    gapToSafe: 15,
    gapToLikely: 2,
    bounded: { safe: false, likely: false },
  },
  warnings: [],
  notes: [],
};

describe('buildDesiredShareText', () => {
  it('carries branch, category, rank range, both corrects ends, the gap label and the link', () => {
    const text = buildDesiredShareText(desiredBase);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Eyeconic Desired Branch — MD General Medicine (NEET PG, UR)');
    expect(lines[1]).toBe('Historical closing rank: 9,500 – 14,200');
    expect(lines).toContain('Aim for ≈ 165 corrects (safe end)');
    expect(lines).toContain('Historically enough: ≈ 152 corrects');
    expect(lines).toContain('My average: 150 corrects — Below the historical range');
    expect(lines).toContain('Historical estimate — cutoffs move every year.');
    expect(lines[lines.length - 1]).toBe('https://www.eyeconicneetpg.com/predictor');
  });

  it('states the safe end honestly when it resolved beyond the data (no invented number)', () => {
    const text = buildDesiredShareText({
      ...desiredBase,
      required: {
        ...desiredBase.required!,
        perClosing: [
          { closing: 9500, corrects: null, state: 'above-distribution', bounded: true },
          { closing: 14200, corrects: 152, state: 'in-distribution', bounded: false },
        ],
      },
    });
    expect(text).toContain('Safe end: beyond the data');
    expect(text).not.toContain('Aim for');
    expect(text).toContain('Historically enough: ≈ 152 corrects');
  });

  it('omits the average line when no current GTs were given (target-only run)', () => {
    const text = buildDesiredShareText({ ...desiredBase, current: null, gap: null });
    expect(text).not.toContain('My average');
    expect(text).toContain('Historical closing rank: 9,500 – 14,200');
  });

  it('marks PwD next to the category when it was part of the input', () => {
    const text = buildDesiredShareText({
      ...desiredBase,
      input: { ...desiredBase.input, category: { value: 'OBC', pwd: true }, pwd: true },
    });
    expect(text.startsWith('Eyeconic Desired Branch — MD General Medicine (NEET PG, OBC PwD)')).toBe(true);
  });
});
