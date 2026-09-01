/**
 * Regression tests — quiz creation validation (dates, duration, sections).
 *
 * Locks in the fixes for the reported production issues:
 *   - same-day / cross-day / short-gap time windows must create cleanly,
 *   - end-before-start and unparseable dates are rejected with 400 + a clear
 *     message (previously unparseable dates crashed save() with a 500
 *     "Server error", and ordering was not checked at all),
 *   - malformed duration (null/NaN/non-positive — e.g. a cleared Duration
 *     input, which the app used to send as null) is a 400 instead of a 500
 *     Mongoose CastError,
 *   - `sections: []` means "no sections configured" (legacy quiz edits) and
 *     no longer trips the section-duration check,
 *   - PUT enforces the window invariant on the effective final state.
 */
const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuestionBank = require('../../models/QuestionBank');

let app;
let admin;
let subject;
let questionIds = [];

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
  admin = await createUser({ role: 'admin' });
  subject = await createSubject('Physics');

  const questions = await QuestionBank.create([
    {
      subject: subject._id,
      topicName: 'Kinematics',
      subtopicName: 'Motion',
      system: 'Mechanics',
      questionType: 'mcq_single',
      difficulty: 'medium',
      question: 'Q1?',
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 0,
    },
    {
      subject: subject._id,
      topicName: 'Optics',
      subtopicName: 'Lenses',
      system: 'Physics',
      questionType: 'mcq_single',
      difficulty: 'easy',
      question: 'Q2?',
      options: ['A', 'B', 'C', 'D'],
      correctAnswer: 1,
    },
  ]);
  questionIds = questions.map((q) => q._id.toString());
});

// The exact body shape handleCreateQuiz() in app/(tabs)/quizzes/create-quiz.tsx
// posts after the wizard (Step 4 forces >= 1 section summing to the duration).
const mobilePayload = (overrides = {}) => ({
  title: 'Physics Daily Test',
  subjects: [subject._id.toString()],
  testType: 'daily',
  numberOfQuestions: questionIds.length,
  selectedQuestionIds: questionIds,
  duration: 30,
  positiveMarks: 4,
  negativeMarks: 1,
  instructions: ['Read carefully.'],
  assignedStudents: [],
  assignedMentors: [],
  shareSolution: true,
  assignToAllFreeUsers: false,
  scheduledDate: undefined,
  expiryDate: undefined,
  sections: [{ name: 'Section 1', duration: 30, selectionType: 'mixed', questions: [] }],
  ...overrides,
});

const postCreate = (payload) =>
  request(app)
    .post('/api/quizzes/create-from-bank')
    .set('Authorization', `Bearer ${admin.token}`)
    .send(payload);

describe('POST /api/quizzes/create-from-bank — valid time windows', () => {
  it('creates a normal future quiz (start future, end later same day)', async () => {
    const start = new Date('2026-10-01T10:00:00');
    const end = new Date('2026-10-01T11:30:00');
    const res = await postCreate(
      mobilePayload({ scheduledDate: start.toISOString(), expiryDate: end.toISOString() })
    );
    expect(res.status).toBe(201);
    expect(new Date(res.body.quiz.scheduledDate).getTime()).toBe(start.getTime());
    expect(new Date(res.body.quiz.expiryDate).getTime()).toBe(end.getTime());
  });

  it('creates a same-day quiz with a 30-minute gap (reported as "not getting created")', async () => {
    const start = new Date('2026-08-31T17:00:00'); // 5:00 PM local
    const end = new Date('2026-08-31T17:30:00'); //  5:30 PM local
    const res = await postCreate(
      mobilePayload({ scheduledDate: start.toISOString(), expiryDate: end.toISOString() })
    );
    expect(res.status).toBe(201);
    expect(res.body.quiz.duration).toBe(30);
  });

  it('creates a same-day quiz with a 5-minute gap', async () => {
    const start = new Date('2026-08-31T17:00:00');
    const end = new Date('2026-08-31T17:05:00');
    const res = await postCreate(
      mobilePayload({ scheduledDate: start.toISOString(), expiryDate: end.toISOString() })
    );
    expect(res.status).toBe(201);
  });

  it('creates a cross-day quiz (11:30 PM → 12:30 AM next day)', async () => {
    const start = new Date('2026-08-31T23:30:00');
    const end = new Date('2026-09-01T00:30:00');
    const res = await postCreate(
      mobilePayload({ scheduledDate: start.toISOString(), expiryDate: end.toISOString() })
    );
    expect(res.status).toBe(201);
  });

  it('creates a quiz without a time window (null dates)', async () => {
    const res = await postCreate(mobilePayload({ scheduledDate: null, expiryDate: null }));
    expect(res.status).toBe(201);
    expect(res.body.quiz.scheduledDate).toBeFalsy();
    expect(res.body.quiz.expiryDate).toBeFalsy();
  });

  it('treats empty-string dates as absent (back-compat with form posts)', async () => {
    const res = await postCreate(mobilePayload({ scheduledDate: '', expiryDate: '' }));
    expect(res.status).toBe(201);
  });

  it('creates the full wizard payload (sections + students + mentors + window)', async () => {
    const student = await createUser({ role: 'student' });
    const mentor = await createUser({ role: 'mentor' });
    const res = await postCreate(
      mobilePayload({
        assignedStudents: [student.user._id.toString()],
        assignedMentors: [mentor.user._id.toString()],
        scheduledDate: new Date('2026-09-05T09:00:00').toISOString(),
        expiryDate: new Date('2026-09-05T10:00:00').toISOString(),
      })
    );
    expect(res.status).toBe(201);
    expect(res.body.quiz.assignedStudents.length).toBe(1);
    expect(res.body.quiz.assignedMentors.length).toBe(1);
    expect(res.body.quiz.sections.length).toBe(1);
  });
});

describe('POST /api/quizzes/create-from-bank — rejected payloads are 400 with clear messages', () => {
  it('rejects end-before-start on the same day (the screenshot state)', async () => {
    const start = new Date('2026-08-31T17:00:00'); // 5:00 PM
    const end = new Date('2026-08-31T05:35:00'); //  5:35 AM
    const res = await postCreate(
      mobilePayload({ scheduledDate: start.toISOString(), expiryDate: end.toISOString() })
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('End date must be after start date');
  });

  it('rejects equal start and end', async () => {
    const same = new Date('2026-08-31T17:00:00').toISOString();
    const res = await postCreate(mobilePayload({ scheduledDate: same, expiryDate: same }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('End date must be after start date');
  });

  it('rejects an unparseable scheduledDate instead of crashing save() with 500', async () => {
    const res = await postCreate(mobilePayload({ scheduledDate: '31/8/2026, 5:35:54 AM' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Start date & time is invalid/);
  });

  it('rejects an unparseable expiryDate', async () => {
    const res = await postCreate(mobilePayload({ expiryDate: 'not-a-date' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/End date & time is invalid/);
  });

  it('rejects a null/NaN duration (cleared Duration input) instead of 500 Server error', async () => {
    const res = await postCreate(mobilePayload({ duration: null }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Quiz duration must be a positive number of minutes');
  });

  it('rejects a non-numeric duration string', async () => {
    const res = await postCreate(mobilePayload({ duration: 'abc' }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Quiz duration must be a positive number of minutes');
  });

  it('rejects a zero/negative duration', async () => {
    const zero = await postCreate(mobilePayload({ duration: 0 }));
    expect(zero.status).toBe(400);
    const negative = await postCreate(mobilePayload({ duration: -5 }));
    expect(negative.status).toBe(400);
  });

  it('rejects an empty subjects array with 400 instead of a 500 validation error', async () => {
    const res = await postCreate(mobilePayload({ subjects: [] }));
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('At least one subject is required');
  });

  it('rejects malformed student/mentor/question IDs with 400 instead of 500', async () => {
    const students = await postCreate(mobilePayload({ assignedStudents: ['not-an-object-id'] }));
    expect(students.status).toBe(400);
    const mentors = await postCreate(mobilePayload({ assignedMentors: ['nope'] }));
    expect(mentors.status).toBe(400);
    const questions = await postCreate(mobilePayload({ selectedQuestionIds: ['bogus'] }));
    expect(questions.status).toBe(400);
  });
});

describe('sections handling', () => {
  it('treats sections: [] as "no sections" (legacy quiz edit state)', async () => {
    const res = await postCreate(mobilePayload({ sections: [] }));
    expect(res.status).toBe(201);
    expect(res.body.quiz.sections).toEqual([]);
  });

  it('still rejects sections whose total does not match the duration', async () => {
    const res = await postCreate(
      mobilePayload({
        duration: 45,
        sections: [{ name: 'S1', duration: 30, selectionType: 'mixed', questions: [] }],
      })
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Section duration total/);
  });

  it('creates valid multi-section payloads', async () => {
    const res = await postCreate(
      mobilePayload({
        sections: [
          { name: 'S1', duration: 15, selectionType: 'mixed', questions: [] },
          { name: 'S2', duration: 15, selectionType: 'mixed', questions: [] },
        ],
      })
    );
    expect(res.status).toBe(201);
    expect(res.body.quiz.sections.length).toBe(2);
  });
});

describe('PUT /api/quizzes/:id — edit flow', () => {
  let legacyQuiz;

  beforeEach(async () => {
    // Legacy quiz created before sections / date validation existed.
    legacyQuiz = await Quiz.create({
      title: 'Legacy Quiz',
      subject: subject._id,
      testType: 'daily',
      duration: 30,
      questions: questionIds,
      createdBy: admin.user._id,
    });
  });

  const putQuiz = (payload) =>
    request(app)
      .put(`/api/quizzes/${legacyQuiz._id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send(payload);

  it('updates a legacy quiz that has no sections (sections: [] in payload)', async () => {
    const res = await putQuiz({
      title: 'Legacy Quiz Updated',
      duration: 30,
      questions: questionIds,
      sections: [],
      scheduledDate: new Date('2026-09-05T09:00:00').toISOString(),
      expiryDate: new Date('2026-09-05T10:00:00').toISOString(),
    });
    expect(res.status).toBe(200);
    expect(res.body.quiz.title).toBe('Legacy Quiz Updated');
    expect(new Date(res.body.quiz.expiryDate).getTime()).toBe(
      new Date('2026-09-05T10:00:00').getTime()
    );
  });

  it('rejects setting expiry before start in the payload', async () => {
    const res = await putQuiz({
      duration: 30,
      scheduledDate: new Date('2026-09-05T10:00:00').toISOString(),
      expiryDate: new Date('2026-09-05T09:00:00').toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('End date must be after start date');
  });

  it('rejects a new expiry that precedes the quiz’s existing scheduled start', async () => {
    await putQuiz({
      duration: 30,
      scheduledDate: new Date('2026-09-05T09:00:00').toISOString(),
      expiryDate: new Date('2026-09-05T10:00:00').toISOString(),
    });

    // Payload carries only the end date; effective window must still be valid.
    const res = await putQuiz({
      duration: 30,
      expiryDate: new Date('2026-09-05T08:00:00').toISOString(),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('End date must be after start date');
  });

  it('rejects an unparseable date string with 400 instead of 500', async () => {
    const res = await putQuiz({ duration: 30, scheduledDate: '31/8/2026, 5:35:54 AM' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Start date & time is invalid/);
  });

  it('rejects a malformed duration with 400 (existing behavior preserved)', async () => {
    const res = await putQuiz({ duration: null });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/duration/);
  });
});
