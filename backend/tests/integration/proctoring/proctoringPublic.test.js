// Integration tests for PUBLIC-quiz AI proctoring (Phase 2, 2026-10-23):
// mandatory OTP verification (owner decision D-P1 — every public quiz,
// proctored or not), precheck → consent → gated /start, guest-owner event
// ingest through the shared pipeline, session close on finalize, the
// owner-guest timeline read, and the access-control matrix.
//
// Locked lifecycle rules (mirrors proctoringLifecycle.test.js for the guest
// surface):
//   - anonymous /start is refused with an actionable payload + webUrl and
//     creates ZERO rows — on armed AND unarmed public quizzes
//   - precheck/consent never create attempts or sessions; camera is REQUIRED
//     (owner decision D-P2): a failing camera check blocks the token
//   - a gated /start leaves zero rows behind; gates-off ⇒ ungated start
//   - events flow through the SAME pipeline as registered attempts (rules,
//     warnings, risk), scoped to the caller's own attempt
//   - every guest finalization path closes the session and mirrors
//     integrityStatus onto the GuestAttempt

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

let mockAiProctoringFlag = true;
jest.mock('../../../config/featureAvailability', () => {
  const actual = jest.requireActual('../../../config/featureAvailability');
  return {
    ...actual,
    isFeatureEnabled: (feature) =>
      feature === 'aiProctoring' ? mockAiProctoringFlag : actual.isFeatureEnabled(feature),
  };
});

const request = require('supertest');
const db = require('../../helpers/db');
const { buildApp, createUser, createSubject } = require('../../helpers/testApp');
const Quiz = require('../../../models/Quiz');
const QuestionBank = require('../../../models/QuestionBank');
const GuestAttempt = require('../../../models/GuestAttempt');
const Guest = require('../../../models/Guest');
const ProctoringSession = require('../../../models/ProctoringSession');
const ProctoringEvent = require('../../../models/ProctoringEvent');
const ProctoringConsent = require('../../../models/ProctoringConsent');
const { setProctoringEnabled } = require('../../../utils/appSettings');
const {
  resetPublicPrecheckRateLimits,
  resetPublicProctoringEventRateLimits,
} = require('../../../middleware/publicProctoringRateLimit');

// OTP mailer mock (same pattern as guestAttemptLead.test.js).
const sentOtps = [];
jest.mock('../../../utils/mailer', () => ({
  ...jest.requireActual('../../../utils/mailer'),
  sendGuestQuizOtpMail: jest.fn(async (email, otp) => {
    sentOtps.push({ email, otp });
  }),
}));

let app;
let admin;
let subject;
let questionSeed = 0;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
  admin = await createUser({ role: 'admin', name: 'Admin' });
  subject = await createSubject('Public Proctoring Subject');
  await setProctoringEnabled(true); // kill switch ON for the whole suite
});

afterAll(async () => {
  await db.closeDatabase();
});

const ARMED_PROCTORING = {
  enabled: true,
  camera: 'required',
  focusEvents: { mode: 'warn-only' },
  multipleFaces: { mode: 'record' },
  facePresence: { mode: 'record' },
  attention: { mode: 'warn' },
};

async function createQuestion() {
  return QuestionBank.create({
    subject: subject._id,
    topicName: 'Genetics',
    subtopicName: 'Mendelian Inheritance',
    system: 'Genetic Disorders',
    questionType: 'mcq_single',
    difficulty: 'medium',
    question: `Public proctoring Q${++questionSeed}?`,
    options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
    correctAnswer: 1,
  });
}

async function setupQuiz({ armed = true, sections = false } = {}) {
  const questions = [];
  for (let i = 0; i < 2; i += 1) questions.push(await createQuestion());
  const quiz = await Quiz.create({
    title: `Public Proctoring Test ${Date.now()}-${Math.random().toString(36).slice(2)}`,
    subject: subject._id,
    testType: 'daily',
    duration: 10,
    questions: questions.map((q) => q._id),
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
    isPublic: true,
    shareToken: `pp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...(armed ? { proctoring: ARMED_PROCTORING } : {}),
    // Section durations must sum to the quiz duration (10) — the authoring
    // contract buildSectionSnapshot enforces.
    ...(sections
      ? {
          sections: [
            { name: 'Section A', duration: 5, selectionType: 'manual', questions: [questions[0]._id] },
            { name: 'Section B', duration: 5, selectionType: 'manual', questions: [questions[1]._id] },
          ],
        }
      : {}),
  });
  return { quiz, questions };
}

// Full lead verification through the real OTP API → { guestToken, lead, guestId }
async function verifyLead(quiz, { name = 'Public Tester', email } = {}) {
  const payload = {
    name,
    email: email || `public-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    phone: '+919876543210',
    marketingConsent: true,
  };
  await request(app).post(`/api/public/quiz/${quiz.shareToken}/lead/send-otp`).send(payload);
  const otp = sentOtps[sentOtps.length - 1].otp;
  const res = await request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/lead/verify-otp`)
    .send({ ...payload, otp });
  expect(res.status).toBe(200);
  return { guestToken: res.body.guestToken, lead: res.body.guest, guestId: `web-${Math.random().toString(36).slice(2)}` };
}

const webPassReport = () => ({
  device: { platform: 'web', osVersion: 120 },
  network: { reachable: true, authedPingMs: 90 },
  checks: [
    { id: 'device_capability', status: 'PASS' },
    { id: 'camera_permission', status: 'PASS' },
    { id: 'camera_availability', status: 'PASS' },
    {
      id: 'face_readiness', status: 'PASS',
      metadata: {
        frames: 5, agreedFrames: 4, faceCountClass: 'one', visibility: 'ok',
        attentionBaseline: { yaw: -2.5, pitch: 1.2, roll: 0.3, frames: 4 },
      },
    },
    { id: 'network', status: 'PASS' },
  ],
});

const reportPrecheck = (quiz, guestToken, payload = webPassReport()) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/proctoring/precheck-report`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send(payload);

const giveConsent = (quiz, guestToken, precheckToken) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/proctoring/consent`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ precheckToken, consentTextVersion: '2026-11-v1-web', surface: 'web' });

// precheck + consent in one step (the happy-path arming sequence).
async function armLead(quiz, guestToken) {
  const pre = await reportPrecheck(quiz, guestToken);
  expect(pre.status).toBe(200);
  expect(pre.body.verdict).toBe('PASS');
  const consent = await giveConsent(quiz, guestToken, pre.body.precheckToken);
  expect(consent.status).toBe(200);
  return pre.body.precheckToken;
}

const startAttempt = (quiz, guestToken, guestId, precheckToken) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/start`)
    .set('Authorization', `Bearer ${guestToken}`)
    .send({ guestId, deviceInfo: 'web', ...(precheckToken ? { precheckToken } : {}) });

let eventSeq = 0;
const episodeEvent = (type, { durationMs = 3000, source = 'browser' } = {}) => {
  eventSeq += 1;
  const opened = new Date(Date.now() - durationMs);
  return {
    idempotencyKey: `pp-evt-${Date.now()}-${eventSeq}-${Math.random().toString(36).slice(2)}`,
    clientSeq: eventSeq,
    type,
    source,
    openedAt: opened.toISOString(),
    closedAt: new Date().toISOString(),
  };
};

const sendEvents = (quiz, { guestToken, guestId, attemptId, sessionId }, events, extra = {}) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/proctoring/events`)
    .set('Authorization', guestToken ? `Bearer ${guestToken}` : '')
    .send({
      guestId,
      sessionId: String(sessionId),
      seq: events.length ? events[events.length - 1].clientSeq : undefined,
      heartbeat: events.length === 0 ? true : undefined,
      events,
      ...extra,
    });

// =====================================================================
// A. Mandatory OTP verification (D-P1) — every public quiz
// =====================================================================
describe('public proctoring — mandatory OTP verification', () => {
  afterAll(() => {
    resetPublicProctoringEventRateLimits();
  });

  it('refuses an anonymous start on an UNARMED public quiz with the actionable payload', async () => {
    const { quiz } = await setupQuiz({ armed: false });
    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .send({ guestId: 'anon-device-1' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('GUEST_VERIFICATION_REQUIRED');
    expect(res.body.webUrl).toContain(`/public-quiz/${quiz.shareToken}`);
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id })).toBe(0);
  });

  it('refuses an anonymous start on an ARMED public quiz the same way', async () => {
    const { quiz } = await setupQuiz({ armed: true });
    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/start`)
      .send({ guestId: 'anon-device-2' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('GUEST_VERIFICATION_REQUIRED');
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id })).toBe(0);
    expect(await ProctoringSession.countDocuments({ quiz: quiz._id })).toBe(0);
  });

  it('lets a verified lead start an unarmed quiz without any proctoring', async () => {
    const { quiz } = await setupQuiz({ armed: false });
    const lead = await verifyLead(quiz);
    const res = await startAttempt(quiz, lead.guestToken, lead.guestId);
    expect(res.status).toBe(201);
    expect(res.body.proctoringSessionId).toBeUndefined();
    const attempt = await GuestAttempt.findById(res.body.attempt._id);
    expect(attempt.proctoringSnapshot).toBeUndefined();
  });

  it('keeps a pre-policy anonymous in-progress attempt operable (transition policy)', async () => {
    const { quiz, questions } = await setupQuiz({ armed: false });
    // Simulate an attempt created BEFORE the policy deployed (guest:null).
    const legacy = await GuestAttempt.create({
      quiz: quiz._id,
      guestId: 'legacy-device-1',
      guest: null,
      totalQuestions: questions.length,
      totalMarks: 8,
      startTime: new Date(),
      answers: questions.map((q, i) => ({
        questionIndex: i, questionId: q._id, selectedAnswer: -1, isCorrect: false, markedForReview: false, timeSpent: 0,
      })),
    });
    // save-progress keeps working for the legacy device flow…
    const save = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
      .send({ guestId: 'legacy-device-1', attemptId: legacy._id, answers: [] });
    expect(save.status).toBe(200);
    // …and so does submit (ownership by device key).
    const submit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .send({ guestId: 'legacy-device-1', attemptId: legacy._id, answers: [] });
    expect([200, 201]).toContain(submit.status);
    expect((await GuestAttempt.findById(legacy._id)).status).not.toBe('in_progress');
  });
});

// =====================================================================
// B. Metadata disclosure
// =====================================================================
describe('public proctoring — landing-page metadata', () => {
  it('discloses proctoringRequired + cameraRequired + webUrl for an armed quiz', async () => {
    const { quiz } = await setupQuiz({ armed: true });
    const res = await request(app).get(`/api/public/quiz/${quiz.shareToken}`);
    expect(res.status).toBe(200);
    expect(res.body.quiz.proctoringRequired).toBe(true);
    expect(res.body.quiz.cameraRequired).toBe(true);
    expect(res.body.quiz.webUrl).toContain(`/public-quiz/${quiz.shareToken}`);
  });

  it('never asks for a camera on an unarmed quiz', async () => {
    const { quiz } = await setupQuiz({ armed: false });
    const res = await request(app).get(`/api/public/quiz/${quiz.shareToken}`);
    expect(res.body.quiz.proctoringRequired).toBe(false);
    expect(res.body.quiz.cameraRequired).toBeUndefined();
    expect(res.body.quiz.webUrl).toBeDefined();
  });
});

// =====================================================================
// C. Precheck → consent → gated /start
// =====================================================================
describe('public proctoring — gating lifecycle', () => {
  beforeEach(() => {
    resetPublicPrecheckRateLimits();
    resetPublicProctoringEventRateLimits();
  });

  it('refuses /start without consent (zero rows), then completes the full arming sequence', async () => {
    const { quiz } = await setupQuiz({ armed: true });
    const lead = await verifyLead(quiz);

    // No consent + no precheck token → the consent gate fires first.
    const refused = await startAttempt(quiz, lead.guestToken, lead.guestId);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('PROCTORING_CONSENT_REQUIRED');
    expect(await GuestAttempt.countDocuments({ quiz: quiz._id })).toBe(0);
    expect(await ProctoringSession.countDocuments({ quiz: quiz._id })).toBe(0);

    // precheck PASS (web platform, camera required) → token.
    const pre = await reportPrecheck(quiz, lead.guestToken);
    expect(pre.status).toBe(200);
    expect(pre.body.verdict).toBe('PASS');
    expect(pre.body.precheckToken).toBeDefined();
    expect(pre.body.cameraBypassed).toBe(false);

    // Consent without the token → 403; with a WRONG lead's token → 403.
    const other = await verifyLead(quiz, { name: 'Other Lead', email: `other-${Date.now()}@example.com` });
    const foreign = await reportPrecheck(quiz, other.guestToken);
    const wrongOwner = await giveConsent(quiz, lead.guestToken, foreign.body.precheckToken);
    expect(wrongOwner.status).toBe(403);
    expect(wrongOwner.body.code).toBe('PRECHECK_TOKEN_INVALID');

    const consent = await giveConsent(quiz, lead.guestToken, pre.body.precheckToken);
    expect(consent.status).toBe(200);
    // Guest-keyed consent row.
    const consentRow = await ProctoringConsent.findOne({ quiz: quiz._id, guest: lead.lead._id });
    expect(consentRow).toBeTruthy();
    expect(consentRow.surface).toBe('web');
    expect(consentRow.student).toBeFalsy();

    // Gated start succeeds: snapshot + session + arming fields.
    const start = await startAttempt(quiz, lead.guestToken, lead.guestId, pre.body.precheckToken);
    expect(start.status).toBe(201);
    expect(start.body.proctoringSessionId).toBeDefined();
    expect(start.body.proctoringPolicy).toBeDefined();
    expect(start.body.proctoringPolicy.camera).toBe('required');
    expect(start.body.proctoringAttentionBaseline).toMatchObject({ yaw: -2.5, calibration: 'captured' });

    const attempt = await GuestAttempt.findById(start.body.attempt._id);
    expect(attempt.proctoringSnapshot.hash).toBe(start.body.proctoringPolicyDigest);
    expect(attempt.guest.toString()).toBe(lead.lead._id.toString());

    const session = await ProctoringSession.findById(start.body.proctoringSessionId);
    expect(session.ownerKind).toBe('guest');
    expect(session.guest.toString()).toBe(lead.lead._id.toString());
    expect(session.student).toBeFalsy();
    expect(session.baseline.calibration).toBe('captured');
  });

  it('blocks the precheck token when a camera check fails (camera is REQUIRED)', async () => {
    const { quiz } = await setupQuiz({ armed: true });
    const lead = await verifyLead(quiz);
    const failing = webPassReport();
    failing.checks = failing.checks.map((c) => (
      c.id === 'camera_permission' ? { ...c, status: 'FAIL', detail: 'denied' } : c
    ));
    const res = await reportPrecheck(quiz, lead.guestToken, failing);
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe('FAIL');
    expect(res.body.reasons[0].reasonCode).toBe('camera_permission:failed');
    expect(res.body.precheckToken).toBeUndefined();
  });

  it('rate limits precheck reports (10/hour per lead+link)', async () => {
    const { quiz } = await setupQuiz({ armed: true });
    const lead = await verifyLead(quiz);
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await reportPrecheck(quiz, lead.guestToken);
    }
    expect(last.status).toBe(429);
    expect(last.body.code).toBe('RATE_LIMITED');
  });

  it('runs UNPROCTORED when the kill switch is off (§31 semantics)', async () => {
    const { quiz } = await setupQuiz({ armed: true });
    const lead = await verifyLead(quiz);
    await setProctoringEnabled(false);
    try {
      const pre = await reportPrecheck(quiz, lead.guestToken);
      expect(pre.status).toBe(503);
      expect(pre.body.code).toBe('PROCTORING_DISABLED');
      // Ungated start — no token, no snapshot, no session.
      const start = await startAttempt(quiz, lead.guestToken, lead.guestId);
      expect(start.status).toBe(201);
      expect(start.body.proctoringSessionId).toBeUndefined();
      const attempt = await GuestAttempt.findById(start.body.attempt._id);
      expect(attempt.proctoringSnapshot).toBeUndefined();
      expect(await ProctoringSession.countDocuments({ quiz: quiz._id })).toBe(0);
    } finally {
      await setProctoringEnabled(true);
    }
  });

  it('rejects USER tokens on the public proctoring surface', async () => {
    const { quiz } = await setupQuiz({ armed: true });
    const student = await createUser({ role: 'student' });
    const res = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/proctoring/precheck-report`)
      .set('Authorization', `Bearer ${student.token}`)
      .send(webPassReport());
    expect(res.status).toBe(401);
  });
});

// =====================================================================
// D. Event ingest through the shared pipeline (guest owner adapter)
// =====================================================================
describe('public proctoring — event ingest', () => {
  let quiz;
  let lead;
  let attemptId;
  let sessionId;

  beforeAll(async () => {
    quiz = (await setupQuiz({ armed: true })).quiz;
    lead = await verifyLead(quiz);
    const token = await armLead(quiz, lead.guestToken);
    const start = await startAttempt(quiz, lead.guestToken, lead.guestId, token);
    expect(start.status).toBe(201);
    attemptId = start.body.attempt._id;
    sessionId = start.body.proctoringSessionId;
  });

  beforeEach(() => {
    resetPublicProctoringEventRateLimits();
  });

  it('accepts a SESSION_STARTED + TAB_HIDDEN batch and updates session bookkeeping', async () => {    const res = await sendEvents(quiz, { ...lead, attemptId, sessionId }, [
      episodeEvent('SESSION_STARTED', { source: 'system' }),
      episodeEvent('TAB_HIDDEN'),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(2);
    expect(res.body.session.status).toBe('ACTIVE');
    const session = await ProctoringSession.findById(sessionId);
    expect(session.eventCounts.TAB_HIDDEN).toBe(1);
    expect(session.sessionHealth.lastSeenAt).toBeTruthy();
  });

  it('404s another lead probing this attempt (no information leak)', async () => {
    const other = await verifyLead(quiz, { name: 'Probe Lead', email: `probe-${Date.now()}@example.com` });
    const res = await sendEvents(quiz, { ...other, attemptId, sessionId }, [episodeEvent('TAB_HIDDEN')]);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ATTEMPT_NOT_FOUND');
  });

  it('403s a session-id mismatch', async () => {
    const res = await sendEvents(quiz, {
      ...lead, attemptId, sessionId: 'deadbeefdeadbeefdeadbeef',
    }, [episodeEvent('TAB_HIDDEN')]);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SESSION_MISMATCH');
  });

  it('collapses replays via idempotency keys (duplicates, never re-counted)', async () => {
    const evt = episodeEvent('TAB_HIDDEN');
    const first = await sendEvents(quiz, { ...lead, attemptId, sessionId }, [evt]);
    expect(first.body.accepted).toBe(1);
    const replay = await sendEvents(quiz, { ...lead, attemptId, sessionId }, [evt]);
    expect(replay.status).toBe(200);
    expect(replay.body.accepted).toBe(0);
    expect(replay.body.duplicates).toEqual([evt.idempotencyKey]);
  });

  it('delivers a WARN action through the batch response under the warn-only focus policy (never submits)', async () => {
    const events = [1, 2, 3].map(() => episodeEvent('APP_BACKGROUND', { source: 'os', durationMs: 5000 }));
    const res = await sendEvents(quiz, { ...lead, attemptId, sessionId }, events);
    expect(res.status).toBe(200);
    expect(res.body.actions.length).toBeGreaterThan(0);
    expect(res.body.actions[0]).toMatchObject({ kind: 'WARN', code: 'warn.focus' });
    expect(res.body.attemptFinalized).toBeUndefined();
    const attempt = await GuestAttempt.findById(attemptId);
    expect(attempt.status).toBe('in_progress');
    const warnEvents = await ProctoringEvent.find({
      session: sessionId, type: 'WARNING_DELIVERED',
    });
    expect(warnEvents.length).toBeGreaterThan(0);
  });

  it('keeps accepting events via the device key after the guest token expires mid-attempt (save-progress ownership parity)', async () => {
    const res = await sendEvents(quiz, {
      guestToken: null, guestId: lead.guestId, attemptId, sessionId,
    }, [episodeEvent('WINDOW_BLUR')]);
    expect(res.status).toBe(200);
    expect(res.body.accepted).toBe(1);
  });

  it('serves the owner session resync with frozen policy + baseline', async () => {
    const res = await request(app)
      .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/proctoring/session`)
      .set('Authorization', `Bearer ${lead.guestToken}`);
    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe('ACTIVE');
    expect(res.body.policy.camera).toBe('required');
    expect(res.body.proctoringAttentionBaseline).toMatchObject({ yaw: -2.5 });
  });

  it('serves the OWNER timeline and 404s other leads', async () => {
    const own = await request(app)
      .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${lead.guestToken}`);
    expect(own.status).toBe(200);
    expect(own.body.timeline.events.length).toBeGreaterThan(0);
    expect(own.body.timeline.session.status).toBe('ACTIVE');

    const other = await verifyLead(quiz, { name: 'Timeline Probe', email: `tl-${Date.now()}@example.com` });
    const foreign = await request(app)
      .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${other.guestToken}`);
    expect(foreign.status).toBe(404);
  });

  it('never lets a lead token adopt someone else\'s ANONYMOUS attempt on a GET (no device key)', async () => {
    // Pre-policy anonymous attempt on the same quiz (guest:null, another
    // device). A lead token on a body-less GET must resolve ONLY the lead's
    // own attempts — the anonymous-adoption clause requires the creating
    // device key, which a GET cannot supply.
    const anon = await GuestAttempt.create({
      quiz: quiz._id,
      guestId: 'someone-elses-device',
      guest: null,
      totalQuestions: 2,
      totalMarks: 8,
      startTime: new Date(),
      proctoringSnapshot: { version: 3, hash: 'x', policy: {}, frozenAt: new Date() },
      answers: [],
    });
    const res = await request(app)
      .get(`/api/public/quiz/${quiz.shareToken}/attempt/${anon._id}/proctoring/timeline`)
      .set('Authorization', `Bearer ${lead.guestToken}`);
    expect(res.status).toBe(404);
  });

  it('finalizes cleanly: submit closes the session, freezes the summary, mirrors integrityStatus', async () => {
    const submit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .set('Authorization', `Bearer ${lead.guestToken}`)
      .send({ guestId: lead.guestId, attemptId, answers: [] });
    expect(submit.status).toBe(200);

    const session = await ProctoringSession.findById(sessionId);
    expect(session.status).toBe('CLOSED');
    expect(session.summary).toBeTruthy();
    const attempt = await GuestAttempt.findById(attemptId);
    expect(['clean', 'pending']).toContain(attempt.integrityStatus);
    expect(attempt.status).toBe('completed');

    // Post-close batch → 409, counted as rejected telemetry.
    const after = await sendEvents(quiz, { ...lead, attemptId, sessionId }, [episodeEvent('TAB_HIDDEN')]);
    expect(after.status).toBe(409);
    expect(after.body.code).toBe('SESSION_NOT_ACTIVE');

    // Timeline still serves the frozen story.
    const timeline = await request(app)
      .get(`/api/public/quiz/${quiz.shareToken}/attempt/${attemptId}/proctoring/timeline`)
      .set('Authorization', `Bearer ${lead.guestToken}`);
    expect(timeline.status).toBe(200);
    expect(timeline.body.timeline.session.status).toBe('CLOSED');
    expect(timeline.body.timeline.summary).toBeTruthy();
  });
});

// =====================================================================
// E. save-progress on PROCTORED attempts (owner bug report 2026-10-24:
// repeated 500s during a live proctored attempt). The earlier suites
// exercised save-progress only on UNPROCTORED attempts — these tests lock
// the autosave path for armed quizzes: flat and section-locked, repeated
// (autosave cadence), concurrent (dirty-flush racing heartbeat), and the
// post-finalize contract.
// =====================================================================
const saveProgress = (quiz, { guestToken, guestId, attemptId }, payload) =>
  request(app)
    .post(`/api/public/quiz/${quiz.shareToken}/save-progress`)
    .set('Authorization', guestToken ? `Bearer ${guestToken}` : '')
    .send({ guestId, attemptId, ...payload });

describe('public proctoring — save-progress on proctored attempts', () => {
  const { resetGuestOtpRateLimits } = require('../../../middleware/guestOtpRateLimit');

  // Every test verifies fresh leads — the per-IP OTP SEND limiter (10/10min)
  // would otherwise trip mid-file and poison verifyLead with stale codes.
  beforeEach(() => {
    resetGuestOtpRateLimits();
  });

  const savePayload = (questions) => ({
    answers: questions.map((q, i) => ({
      questionIndex: i,
      questionId: q._id,
      selectedAnswer: 1,
      markedForReview: false,
      timeSpent: 5,
    })),
    tabSwitchCount: 0,
    tabSwitchLog: [],
  });

  it('flat proctored attempt: repeated + concurrent autosaves all succeed (200, no 500s)', async () => {
    const { quiz, questions } = await setupQuiz({ armed: true });
    const lead = await verifyLead(quiz);
    const token = await armLead(quiz, lead.guestToken);
    const start = await startAttempt(quiz, lead.guestToken, lead.guestId, token);
    expect(start.status).toBe(201);
    const ctx = { ...lead, attemptId: start.body.attempt._id };

    // Autosave cadence: sequential saves.
    for (let i = 0; i < 3; i += 1) {
      const res = await saveProgress(quiz, ctx, savePayload(questions));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.attemptFinalized).toBeUndefined();
    }
    // Dirty-flush racing the heartbeat: concurrent saves converge (last
    // writer wins per question — the fire-and-forget contract).
    const burst = await Promise.all(
      Array.from({ length: 4 }, () => saveProgress(quiz, ctx, savePayload(questions)))
    );
    burst.forEach((res) => expect(res.status).toBe(200));

    const stored = await GuestAttempt.findById(ctx.attemptId);
    expect(stored.status).toBe('in_progress');
    expect(stored.answers.every((a) => a.selectedAnswer === 1)).toBe(true);
    expect(stored.proctoringSnapshot).toBeTruthy();
  });

  it('section-locked proctored attempt: saves merge into the open section', async () => {
    const { quiz, questions } = await setupQuiz({ armed: true, sections: true });
    const lead = await verifyLead(quiz);
    const token = await armLead(quiz, lead.guestToken);
    const start = await startAttempt(quiz, lead.guestToken, lead.guestId, token);
    expect(start.status).toBe(201);
    expect(start.body.attempt.sectionLockEnabled).toBe(true);
    const ctx = { ...lead, attemptId: start.body.attempt._id };

    const res = await saveProgress(quiz, ctx, savePayload(questions));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const stored = await GuestAttempt.findById(ctx.attemptId);
    expect(stored.status).toBe('in_progress');
  });

  it('post-finalize saves return the finalized contract, never a 500', async () => {
    const { quiz, questions } = await setupQuiz({ armed: true });
    const lead = await verifyLead(quiz);
    const token = await armLead(quiz, lead.guestToken);
    const start = await startAttempt(quiz, lead.guestToken, lead.guestId, token);
    const ctx = { ...lead, attemptId: start.body.attempt._id };

    const submit = await request(app)
      .post(`/api/public/quiz/${quiz.shareToken}/submit`)
      .set('Authorization', `Bearer ${lead.guestToken}`)
      .send({ guestId: lead.guestId, attemptId: ctx.attemptId, answers: [] });
    expect(submit.status).toBe(200);

    const after = await saveProgress(quiz, ctx, savePayload(questions));
    expect(after.status).toBe(404);
    expect(after.body.code).toBeUndefined(); // legacy shape: message-only 404
  });

  it('another lead cannot save into someone else\'s proctored attempt', async () => {
    const { quiz, questions } = await setupQuiz({ armed: true });
    const lead = await verifyLead(quiz);
    const token = await armLead(quiz, lead.guestToken);
    const start = await startAttempt(quiz, lead.guestToken, lead.guestId, token);
    const ctx = { ...lead, attemptId: start.body.attempt._id };

    const other = await verifyLead(quiz, { name: 'Save Probe', email: `sv-${Date.now()}@example.com` });
    const res = await saveProgress(quiz, { ...other, attemptId: ctx.attemptId }, savePayload(questions));
    expect(res.status).toBe(404);
  });
});
