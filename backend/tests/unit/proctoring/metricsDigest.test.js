// Unit tests for the Phase 8 §30.2 observability digest (WS-A / AC-5): the
// zero-data digest still carries all nine dimensions with HONEST verdicts
// (not_captured where nothing is measurable — that IS the AC-5 property),
// the renderers label all nine sections, and the sender is dormant without
// recipients. Models are mocked — no database.

jest.mock('../../../models/ProctoringSession', () => ({ find: jest.fn() }));
jest.mock('../../../models/ProctoringEvent', () => ({ aggregate: jest.fn() }));
jest.mock('../../../models/ProctoringViolation', () => ({ find: jest.fn() }));
jest.mock('../../../models/QuizAttempt', () => ({ find: jest.fn() }));
jest.mock('../../../utils/mailer', () => ({ deliverEmail: jest.fn() }));

const { deliverEmail } = require('../../../utils/mailer');
const ProctoringSession = require('../../../models/ProctoringSession');
const ProctoringEvent = require('../../../models/ProctoringEvent');
const ProctoringViolation = require('../../../models/ProctoringViolation');
const {
  DIGEST_DIMENSIONS,
  DIMENSION_LABELS,
  buildProctoringMetricsDigest,
  renderDigestText,
  renderDigestHtml,
  sendProctoringMetricsDigest,
} = require('../../../utils/proctoring/metricsDigest');

const seedEmptyWindow = () => {
  // The production query chains are find().select().lean() and aggregate().
  const mockFindChain = (result) => ({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(result) }),
  });
  ProctoringSession.find.mockReturnValue(mockFindChain([]));
  ProctoringViolation.find.mockReturnValue(mockFindChain([]));
  ProctoringEvent.aggregate.mockResolvedValue([
    { byType: [], perfContext: [], detectorTiers: [], autoSubmitSessions: [] },
  ]);
};

const WINDOW = { from: new Date('2026-10-18T00:00:00Z'), to: new Date('2026-10-19T00:00:00Z') };

describe('metricsDigest — zero-data honesty (AC-5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    seedEmptyWindow();
  });

  test('a zero-data digest carries all nine dimensions in §30.2 order with honest verdicts', async () => {
    const digest = await buildProctoringMetricsDigest(WINDOW);

    expect(Object.keys(digest.dimensions)).toEqual(DIGEST_DIMENSIONS);
    expect(DIGEST_DIMENSIONS).toHaveLength(9);

    // 5/6/7 are not_captured by design; 1/2/3/8 are partial (proxy or blind
    // spot); 4/9 are measured with null rates at zero data.
    expect(digest.dimensions.falsePositiveRate.verdict).toBe('partial');
    expect(digest.dimensions.detectorReliability.verdict).toBe('partial');
    expect(digest.dimensions.cameraFailureRate.verdict).toBe('partial');
    expect(digest.dimensions.eventAccuracy.verdict).toBe('measured');
    expect(digest.dimensions.appPerformance.verdict).toBe('not_captured');
    expect(digest.dimensions.crashRate.verdict).toBe('not_captured');
    expect(digest.dimensions.deliveryReliability.verdict).toBe('not_captured');
    expect(digest.dimensions.recoverySuccess.verdict).toBe('partial');
    expect(digest.dimensions.autoSubmitCorrectness.verdict).toBe('measured');

    // Measured-but-null at zero data — never an invented 0 rate.
    expect(digest.dimensions.eventAccuracy.value.batchesRejectedPer1000Events).toBeNull();
    expect(digest.dimensions.autoSubmitCorrectness.value.upheldRate).toBeNull();
    expect(digest.dimensions.falsePositiveRate.note).toMatch(/Pipeline live, 0\/0/);
    expect(digest.totals).toEqual({ sessions: 0, events: 0, violations: 0, autoSubmits: 0 });
  });

  test('every dimension carries a basis and a note (no bare numbers)', async () => {
    const digest = await buildProctoringMetricsDigest(WINDOW);
    for (const key of DIGEST_DIMENSIONS) {
      const dimension = digest.dimensions[key];
      expect(typeof dimension.basis).toBe('string');
      expect(dimension.basis.length).toBeGreaterThan(10);
      expect(typeof dimension.note).toBe('string');
      expect(dimension.note.length).toBeGreaterThan(10);
    }
  });

  test('renderDigestText labels all nine sections', async () => {
    const digest = await buildProctoringMetricsDigest(WINDOW);
    const text = renderDigestText(digest);
    for (const key of DIGEST_DIMENSIONS) {
      expect(text).toContain(DIMENSION_LABELS[key]);
    }
    expect(text).toContain('[not captured]');
    expect(text).toContain('Sessions: 0');
  });

  test('renderDigestHtml labels all nine sections', async () => {
    const digest = await buildProctoringMetricsDigest(WINDOW);
    const html = renderDigestHtml(digest);
    for (const key of DIGEST_DIMENSIONS) {
      expect(html).toContain(DIMENSION_LABELS[key]);
    }
  });

  test('rejects an inverted or invalid window', async () => {
    await expect(buildProctoringMetricsDigest({ from: WINDOW.to, to: WINDOW.from }))
      .rejects.toThrow(/from < to/);
  });
});

describe('sendProctoringMetricsDigest — dormant until recipients exist', () => {
  const originalRecipients = process.env.PROCTORING_DIGEST_RECIPIENTS;

  beforeEach(() => {
    jest.clearAllMocks();
    seedEmptyWindow();
  });

  afterEach(() => {
    if (originalRecipients === undefined) delete process.env.PROCTORING_DIGEST_RECIPIENTS;
    else process.env.PROCTORING_DIGEST_RECIPIENTS = originalRecipients;
  });

  test('no recipients → skipped, deliverEmail never called', async () => {
    delete process.env.PROCTORING_DIGEST_RECIPIENTS;
    const result = await sendProctoringMetricsDigest();
    expect(result).toEqual({ skipped: true });
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  test('empty-string recipients → skipped, deliverEmail never called', async () => {
    process.env.PROCTORING_DIGEST_RECIPIENTS = '  ,  ';
    const result = await sendProctoringMetricsDigest();
    expect(result).toEqual({ skipped: true });
    expect(deliverEmail).not.toHaveBeenCalled();
  });

  test('with recipients → one deliverEmail per recipient, nine-section body, dated subject', async () => {
    process.env.PROCTORING_DIGEST_RECIPIENTS = 'mentor1@run.test, mentor2@run.test';
    deliverEmail.mockResolvedValue({ delivered: true });

    const result = await sendProctoringMetricsDigest({ now: new Date('2026-10-19T09:30:00Z') });

    expect(result).toEqual({ skipped: false, sent: 2, failed: 0 });
    expect(deliverEmail).toHaveBeenCalledTimes(2);
    expect(deliverEmail).toHaveBeenCalledWith(
      'mentor1@run.test',
      'Proctoring metrics digest — 2026-10-19',
      expect.stringContaining('False-positive rate'),
      expect.stringContaining('False-positive rate'),
      'PROCTORING DIGEST',
      'proctoring-digest',
      {}
    );
    const [, , html, text] = deliverEmail.mock.calls[0];
    for (const key of DIGEST_DIMENSIONS) {
      expect(text).toContain(DIMENSION_LABELS[key]);
      expect(html).toContain(DIMENSION_LABELS[key]);
    }
  });

  test('a delivery failure is logged, not thrown, and other recipients still send', async () => {
    process.env.PROCTORING_DIGEST_RECIPIENTS = 'bad@run.test, good@run.test';
    deliverEmail.mockRejectedValueOnce(new Error('SMTP down'))
      .mockResolvedValue({ delivered: true });

    const result = await sendProctoringMetricsDigest({ now: new Date('2026-10-19T09:30:00Z') });
    expect(result).toEqual({ skipped: false, sent: 1, failed: 1 });
    expect(deliverEmail).toHaveBeenCalledTimes(2);
  });
});
