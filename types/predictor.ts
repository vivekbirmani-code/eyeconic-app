/** Types for the Rank & Branch Predictor API (/api/predictor/*). */

export type PredictorExamId = 'NEET_PG' | 'INI_CET';

/** An exam's question/marking pattern (echoed by GET /exams and in method blocks). */
export interface ExamPattern {
  totalQuestions: number;
  positive: number;
  negative: number;
  maxMarks: number;
  /** Present in method-block echoes; absent on the bare /exams list. */
  version?: string;
}

/** Provenance for cross-pattern score comparisons (null = same scale). */
export interface DistributionBridge {
  id: string;
  patternVersion: string;
  anchorPatternVersion: string;
  basis: string;
}

export interface PredictorExam {
  id: PredictorExamId;
  label: string;
  available: boolean;
  milestone: string;
  patternVersion: string;
  /** Question/marking numbers — the authoritative source for UI bounds. */
  pattern?: ExamPattern;
}

export type GtProvenance = 'auto-captured' | 'self-reported';

export interface GtAttemptInput {
  corrects: number;
  totalQuestions?: number;
  status?: string;
  endedAt?: string | number | null;
  retestApprovedUsed?: boolean;
  skippedCount?: number;
}

export interface GtInput {
  gtId?: string | null;
  provenance: GtProvenance;
  attempts: GtAttemptInput[];
}

export interface AutoFillGt {
  gtId: string;
  title: string | null;
  provenance: 'auto-captured';
  attempts: GtAttemptInput[];
}

export interface GtsResponse {
  exam: string;
  gts: AutoFillGt[];
  selfReported: { attempts: GtAttemptInput[] }[];
  notes: string[];
}

export type BranchBand = 'COMFORTABLE' | 'WITHIN_RANGE' | 'BORDERLINE' | 'ASPIRATIONAL';

export interface BranchRow {
  institute: string;
  branch: string;
  closingRank: number;
  openingRank: number;
  allottedCount: number;
  year: number;
  /** INI-CET only: 'YYYY-MM' counselling session. */
  session?: string;
  round: string;
  category: string;
  quota: string;
  band: BranchBand;
}

export interface BranchYearSummary {
  snapshotId: string;
  year: number;
  /** INI-CET only: 'YYYY-MM' counselling session (year is its YYYYMM tag). */
  session?: string;
  state: string;
  counts: Record<string, number> & { total: number };
  coverage?: string;
  aboveAllClosings?: boolean;
  beyondAllClosings?: boolean;
  minClosingRank?: number;
  maxClosingRank?: number;
}

export interface CategoryRequiredState {
  stage: 'BRANCHES';
  coverage: 'CATEGORY_REQUIRED';
  message: string;
}

export interface BranchSummary {
  stage: 'BRANCHES';
  coverage: string;
  category: { value: string; pwd: boolean };
  quota: string;
  years: BranchYearSummary[];
  dataCoverage: {
    years: number[];
    snapshotIds: string[];
    roundConvention: string;
    margins: { borderline: number; aspirational: number; provisional: boolean };
  };
  notes: string[];
}

export interface PredictionResult {
  exam: string;
  examLabel: string;
  method: {
    version: string;
    stage: string;
    assumptions: string[];
    /** Pattern the GT inputs and displayed scores are on (§10 echo). */
    pattern?: ExamPattern;
    /** Cross-pattern bridge used for distribution lookups (null = same scale). */
    distributionBridge?: DistributionBridge | null;
    aggregation: { method: string; dedupRule: string };
    widthModel: { id: string; provisional: boolean };
    datasetSnapshots: { distribution: string; counselling: string[] };
  };
  input: {
    gts: {
      gtId: string | null;
      provenance: GtProvenance;
      selected: {
        corrects: number;
        totalQuestions: number;
        endedAt: number | null;
        retestApprovedUsed: boolean;
        skippedCount: number;
      } | null;
      excluded: { corrects: number; reason: string }[];
    }[];
    category: { value: string; pwd: boolean } | null;
    quota: string;
    quotaLabel: string;
    quotaDefaulted: boolean;
  };
  aggregation: {
    n: number;
    values: number[];
    mean: number;
    median: number;
    trimmedMean: number | null;
    sd: number;
    lowDataCaution: boolean;
  };
  estimate: {
    performance: {
      centerCorrects: number;
      halfWidthCorrects: number;
      correctsRange: [number, number];
      scoreRange: [number, number];
      dispersion: { sdCorrects: number };
      patternVersion?: string | null;
      /** The pattern scores/corrects are expressed on (NEET PG 2026+: 180 questions / 720 marks). */
      pattern?: ExamPattern;
    };
    percentile: {
      range: [number, number];
      center: number;
      coverage: string;
    };
    transfer: {
      tiers: { TIER_1: number; TIER_2: number };
      mixedTiers: boolean;
      distributionBridge?: DistributionBridge | null;
    };
    warnings: { code: string; note: string }[];
    notes: string[];
  };
  rank: {
    rankRange: [number | null, number | null];
    bestRank: number | null;
    worstRank: number | null;
    bestBeyondData: boolean;
    worstBeyondData: boolean;
    beyondLastRecordedRank: number | null;
    coverage: string;
    examYear: number;
    /** INI-CET only: the official session this rank range resolved against. */
    session?: string;
  };
  branches: BranchSummary | CategoryRequiredState;
}

export interface PredictResponse {
  predictionId: string;
  persisted: boolean;
  prediction: PredictionResult;
}

export interface BranchesResponse {
  predictionId: string;
  filters: { year: number | null; band: BranchBand | null; page: number; limit: number };
  total: number;
  totalPages: number;
  rows: BranchRow[];
  coverage: string;
  dataCoverage: BranchSummary['dataCoverage'];
  notes: string[];
  verified: boolean;
}

// ---- Outcome capture (§18 Phases 10a+10b) --------------------------------------

export interface OutcomeValues {
  score: number | null;
  percentile: number | null;
  rank: number | null;
}

/** Counselling outcome (Phase 10b, §15) — null until shared. */
export interface OutcomeCounselling {
  status: 'ALLOTTED' | 'NOT_ALLOTTED';
  allottedInstitute: string | null;
  allottedBranch: string | null;
  round: string | null;
}

export interface OutcomeLinkage {
  methodVersion: string;
  datasetSnapshots: { distribution: string; counselling: string[] };
  predictionCreatedAt: string;
  gtsUsed: number | null;
}

export interface OutcomeCaptureRecord {
  predictionId: string;
  outcomeId: string;
  exam: string;
  consentGivenAt: string;
  outcome: OutcomeValues;
  counselling: OutcomeCounselling | null;
  linkage: OutcomeLinkage;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutcomePutResponse extends OutcomeCaptureRecord {
  created: boolean;
}

export interface OutcomeRecordResponse extends OutcomeCaptureRecord {
  linkageCheck: { matches: boolean };
}

export interface OutcomePredictionSummary {
  methodVersion: string;
  percentileRange: [number, number] | null;
  rankRange: [number | null, number | null] | null;
  gtsUsed: number | null;
}

/**
 * GET /predictions/:id/outcome — "nothing recorded yet" is the routine state
 * on every result page, so it is a 200 (recorded: false), never a 404.
 */
export interface OutcomeStatusResponse {
  predictionId: string;
  recorded: boolean;
  outcomeRecord: OutcomeRecordResponse | null;
  predictionSummary: OutcomePredictionSummary;
}

export interface OutcomeSubmission {
  consent: true;
  score?: number | null;
  percentile?: number | null;
  rank?: number | null;
  /** Phase 10b (§15): counselling outcome + allotted branch, if shared. */
  counselling?: {
    status: 'ALLOTTED' | 'NOT_ALLOTTED';
    allottedInstitute?: string | null;
    allottedBranch?: string | null;
    round?: string | null;
  };
}

// ---- Prediction history (§18 Phase 9: stored AND retrievable) -------------------

export interface PredictionHistoryItem {
  id: string;
  exam: string;
  methodVersion: string;
  createdAt: string;
  gtsUsed?: number;
  percentileRange?: [number, number];
  rankRange?: [number | null, number | null];
  branchesCoverage?: string;
}

export interface PredictionsListResponse {
  predictions: PredictionHistoryItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * The full stored prediction record (GET /predictions/:id) — the same six
 * stages the engine served, minus the response-only `examLabel` (the history
 * UI derives it from `exam`).
 */
export type StoredPredictionRecord = Omit<PredictionResult, 'examLabel'> & {
  request: Record<string, unknown>;
  createdAt: string;
};

export interface StoredPredictionResponse {
  predictionId: string;
  integrity: { resultHash: string; recomputedHash: string; matches: boolean };
  prediction: StoredPredictionRecord;
}

// ---- Desired Branch Predictor (Feature 02, DBP — reverse direction) ------------

/** Branch catalog for the picker (GET /branches?exam=). */
export interface BranchCatalogYear {
  snapshotId: string;
  year: number;
  session?: string;
}

export interface BranchCatalogEntry {
  key: string;
  display: string;
  variants: string[];
  perYear: Record<string, { groups: number; instituteCount: number }>;
}

export interface BranchCatalog {
  builtFrom: BranchCatalogYear[];
  branches: BranchCatalogEntry[];
  roundConvention: string;
}

/** Reverse-flow request (POST /desired-branch). GTs are OPTIONAL (gap stage). */
export interface DesiredBranchRequestBody {
  exam: string;
  branchKey: string;
  category: string;
  pwd?: boolean;
  gts?: GtInput[];
}

export type DesiredTargetCoverage = 'MATCHED' | 'SINGLE_YEAR' | 'NO_DATA_FOR_FILTER';

export interface DesiredTargetYear {
  year: number;
  session?: string;
  snapshotId: string;
  present: boolean;
  matched: boolean;
  groups: number;
  closingMin: number | null;
  closingMax: number | null;
  tightest: { institute: string; closing: number; opening: number; allottedCount: number } | null;
  loosest: { institute: string; closing: number; opening: number; allottedCount: number } | null;
}

export interface DesiredTarget {
  stage: 'TARGET_RANK';
  branch: { key: string; display: string };
  category: { value: string; pwd: boolean };
  quota: string;
  years: DesiredTargetYear[];
  targetRankRange: [number, number] | null;
  coverage: DesiredTargetCoverage;
  tightest?: { institute: string; closing: number; opening: number; allottedCount: number; year: number; session?: string };
  loosest?: { institute: string; closing: number; opening: number; allottedCount: number; year: number; session?: string };
  variability: { tightest: number; loosest: number; ratio: number | null; high: boolean } | null;
  dataCoverage: {
    years: number[];
    snapshotIds: string[];
    matchedYears?: number[];
    roundConvention: string;
  };
  notes: string[];
}

/** One closing rank resolved to required score/marks → required corrects. */
export interface DesiredRequiredEntry {
  closing: number;
  /** Required score on the CURRENT exam pattern (NEET PG 2026+: 720 scale). */
  score?: number | null;
  /** The official-data score the closing resolved at (snapshot's scale). */
  anchorScore?: number | null;
  marks?: number | null;
  corrects: number | null;
  state: 'in-distribution' | 'above-distribution' | 'in-ladder' | 'above-ladder' | 'below-ladder';
  bounded: boolean;
  ladderEndCorrects?: number;
  note?: string;
}

export interface DesiredRequired {
  stage: 'REQUIRED_CORRECTS';
  rule: string;
  distribution?: {
    snapshotId: string;
    numericPairs: number;
    lastRank: number;
    patternVersion?: string | null;
    bridge?: { id: string; patternVersion: string };
  };
  prior?: {
    priorId: string;
    provenance: string;
    points: number;
    correctsSpan: [number, number];
    airSpan: [number, number];
    urOnly: boolean;
  };
  perClosing: DesiredRequiredEntry[];
  notes: string[];
}

/** The optional current-average block (forward aggregation shape, reused). */
export interface DesiredCurrent {
  gts: { gtId: string | null; provenance: GtProvenance; selected: { corrects: number; skippedCount: number } | null }[];
  aggregation: {
    n: number;
    values: number[];
    mean: number;
    median: number;
    trimmedMean: number | null;
    sd: number;
    min: number;
    max: number;
    range: number;
    lowDataCaution: boolean;
  };
  meanCorrects: number;
}

export type DesiredGapStatus = 'ON_TRACK' | 'WITHIN_REACH' | 'BELOW_TARGET' | 'NO_CURRENT_DATA';

export interface DesiredGap {
  status: DesiredGapStatus;
  gapToSafe: number | null;
  gapToLikely: number | null;
  bounded: { safe: boolean; likely: boolean };
}

export interface DesiredBranchResult {
  exam: string;
  examLabel: string;
  method: {
    version: string;
    stage: string;
    assumptions: string[];
    /** Pattern the required-corrects targets are expressed on (§10 echo). */
    pattern?: ExamPattern;
    datasetSnapshots: { counselling: string[]; distribution: string | null; prior: string | null };
  };
  input: {
    branch: { key: string; display: string };
    category: { value: string; pwd: boolean };
    pwd: boolean;
    quota: string;
    quotaLabel: string;
    gts: DesiredCurrent['gts'] | null;
  };
  target: DesiredTarget;
  required: DesiredRequired | null;
  current: DesiredCurrent | null;
  gap: DesiredGap | null;
  warnings: { code: string; note: string }[];
  notes: string[];
}

export interface DesiredBranchResponse {
  desiredBranchId: string;
  persisted: boolean;
  result: DesiredBranchResult;
}
