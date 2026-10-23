const db = require('../helpers/db');
const { createUser } = require('../helpers/testApp');
const Quiz = require('../../models/Quiz');
const QuestionBank = require('../../models/QuestionBank');
const QuizAttempt = require('../../models/QuizAttempt');
const GuestAttempt = require('../../models/GuestAttempt');
const Subject = require('../../models/Subject');
const socketHelpers = require('../../utils/socket-helpers');
const { linkGuestAttemptsToUser } = require('../../utils/linkGuestAttempts');

beforeAll(async () => {
  await db.connect();
});

afterAll(async () => {
  await db.closeDatabase();
});

let questionSeed = 0;

async function createQuiz() {
  const admin = await createUser({ role: 'admin' });
  const subject = await Subject.create({ name: 'Linking Physiology', year: '1st', displayOrder: 1 });
  const question = await QuestionBank.create({
    subject: subject._id,
    topicName: 'Cardiology',
    subtopicName: 'Cardiac Cycle',
    system: 'Cardiovascular',
    questionType: 'mcq_single',
    difficulty: 'easy',
    question: `Linking question #${++questionSeed}?`,
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    correctAnswer: 1,
    createdBy: admin.user._id,
  });
  const quiz = await Quiz.create({
    title: 'Guest Linking Test',
    subject: subject._id,
    testType: 'daily',
    duration: 30,
    questions: [question._id],
    positiveMarks: 4,
    negativeMarks: 1,
    createdBy: admin.user._id,
  });
  return quiz;
}

async function createGuestAttempt(quiz, guestId, overrides = {}) {
  return GuestAttempt.create({
    quiz: quiz._id,
    guestId,
    status: 'completed',
    startTime: new Date(Date.now() - 20 * 60 * 1000),
    endTime: new Date(),
    answers: [{ questionIndex: 0, selectedAnswer: 1, isCorrect: true }],
    score: 1,
    totalQuestions: 1,
    marksObtained: 4,
    totalMarks: 4,
    ...overrides,
  });
}

describe('linkGuestAttemptsToUser', () => {
  let roomEmit;
  let fakeIo;

  beforeEach(async () => {
    await db.clearDatabase();
    roomEmit = jest.fn();
    fakeIo = { to: jest.fn(() => ({ emit: roomEmit })) };
    socketHelpers.setIo(fakeIo);
  });

  afterEach(async () => {
    socketHelpers.setIo(null);
  });

  it('materializes a completed guest attempt and nudges the leaderboard room', async () => {
    const quiz = await createQuiz();
    const guest = await createGuestAttempt(quiz, 'device-1');
    const student = await createUser({ role: 'student' });

    const linked = await linkGuestAttemptsToUser({ guestId: 'device-1', userId: student.user._id });

    expect(linked).toBe(1);

    const attempt = await QuizAttempt.findOne({ quiz: quiz._id, student: student.user._id });
    expect(attempt).not.toBeNull();
    expect(attempt.status).toBe('completed');
    expect(attempt.score).toBe(1);
    expect(attempt.marksObtained).toBe(4);

    // One nudge, to the quiz's room, AFTER the row was persisted — payload
    // mirrors the finalize path (nudge, never scores).
    expect(fakeIo.to).toHaveBeenCalledWith(`leaderboard:${quiz._id}`);
    expect(roomEmit).toHaveBeenCalledTimes(1);
    const [event, payload] = roomEmit.mock.calls[0];
    expect(event).toBe('quiz_leaderboard_updated');
    expect(payload.quizId).toBe(quiz._id.toString());
    expect(payload.attemptId).toBe(attempt._id.toString());
    expect(payload.studentId).toBe(student.user._id.toString());
    expect(payload.cohort).toBe('internal');
    expect(payload.submittedAt).toBeDefined();

    // The guest row is marked linked.
    expect(await GuestAttempt.findById(guest._id)).toMatchObject({ linkedUser: student.user._id });

    // The materialized attempt is what a leaderboard refetch would rank.
    expect(await QuizAttempt.countDocuments({ quiz: quiz._id, status: 'completed' })).toBe(1);
  });

  it('is idempotent: already-linked guest rows produce nothing', async () => {
    const quiz = await createQuiz();
    const student = await createUser({ role: 'student' });
    await createGuestAttempt(quiz, 'device-2', { linkedUser: student.user._id });

    const linked = await linkGuestAttemptsToUser({ guestId: 'device-2', userId: student.user._id });

    expect(linked).toBe(0);
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('ignores in-progress guest attempts (same cohort rule as every leaderboard query)', async () => {
    const quiz = await createQuiz();
    const student = await createUser({ role: 'student' });
    await createGuestAttempt(quiz, 'device-3', { status: 'in_progress', endTime: undefined });

    const linked = await linkGuestAttemptsToUser({ guestId: 'device-3', userId: student.user._id });

    expect(linked).toBe(0);
    expect(await QuizAttempt.countDocuments({})).toBe(0);
    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('skips quizzes the user already attempted but still marks the guest row linked', async () => {
    const quiz = await createQuiz();
    const student = await createUser({ role: 'student' });
    await QuizAttempt.create({
      quiz: quiz._id,
      student: student.user._id,
      status: 'completed',
      score: 0,
      totalQuestions: 1,
      marksObtained: 0,
      totalMarks: 4,
      answers: [],
    });
    const guest = await createGuestAttempt(quiz, 'device-4');

    const linked = await linkGuestAttemptsToUser({ guestId: 'device-4', userId: student.user._id });

    expect(linked).toBe(0);
    expect(await QuizAttempt.countDocuments({ quiz: quiz._id })).toBe(1); // the pre-existing one only
    expect(roomEmit).not.toHaveBeenCalled();
    expect(await GuestAttempt.findById(guest._id)).toMatchObject({ linkedUser: student.user._id });
  });

  it('emits one nudge per materialized attempt across multiple quizzes', async () => {
    const quizA = await createQuiz();
    const quizB = await createQuiz();
    const student = await createUser({ role: 'student' });
    await createGuestAttempt(quizA, 'device-5');
    await createGuestAttempt(quizB, 'device-5');

    const linked = await linkGuestAttemptsToUser({ guestId: 'device-5', userId: student.user._id });

    expect(linked).toBe(2);
    expect(roomEmit).toHaveBeenCalledTimes(2);
    const rooms = fakeIo.to.mock.calls.map(([room]) => room);
    expect(rooms).toEqual(
      expect.arrayContaining([`leaderboard:${quizA._id}`, `leaderboard:${quizB._id}`])
    );
  });

  it('returns 0 without touching anything for missing inputs', async () => {
    expect(await linkGuestAttemptsToUser({ guestId: null, userId: 'x' })).toBe(0);
    expect(await linkGuestAttemptsToUser({ guestId: 'device-6', userId: null })).toBe(0);
    expect(roomEmit).not.toHaveBeenCalled();
  });
});
