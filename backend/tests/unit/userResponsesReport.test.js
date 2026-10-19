const {
  collectUserResponses,
} = require('../../utils/userResponsesReport');

// Plain-object fixtures mirroring the documents collectTestReportData feeds
// the collector. Question docs carry populated subjects so no DB round-trip
// happens (the collector only populates when a subject name is missing), and
// every call passes the UNPOPULATED freshQuiz so the lean Quiz fetch is
// never triggered either.
const questionDoc = (id, overrides = {}) => ({
  _id: id,
  question: `Question ${id}?`,
  questionType: 'mcq_single',
  options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
  correctAnswer: 1,
  subject: { name: 'Pathology' },
  topicName: 'Genetics',
  ...overrides,
});

const attemptDoc = (id, answers, overrides = {}) => ({
  _id: id,
  totalQuestions: 2,
  answers,
  student: { name: 'Student One', email: 'one@example.com', phone: '+919800000001' },
  ...overrides,
});

const studentRow = (attemptId, overrides = {}) => ({
  attemptId,
  studentId: 'stu1',
  studentName: 'Student One',
  studentEmail: 'one@example.com',
  rank: 1,
  score: 1,
  marksObtained: 4,
  totalMarks: 8,
  scorePercentage: 50,
  correct: 1,
  incorrect: 1,
  skipped: 0,
  status: 'completed',
  startedAt: new Date('2026-10-01T10:00:00Z'),
  completedAt: new Date('2026-10-01T10:10:00Z'),
  ...overrides,
});

// Populated quiz doc (docs only — deleted refs are simply absent).
const populatedQuiz = (docs) => ({
  _id: 'quiz1',
  title: 'Unit Quiz',
  positiveMarks: 4,
  negativeMarks: 1,
  sections: [],
  questions: docs,
});

// The UNPOPULATED quiz shape the pairing contract needs: raw question ids
// (including refs whose doc no longer exists), never docs.
const freshQuizOf = (questionIds) => ({
  _id: 'quiz1',
  positiveMarks: 4,
  negativeMarks: 1,
  sections: [],
  questions: questionIds,
});

const collect = (overrides = {}) => collectUserResponses({
  quiz: populatedQuiz([questionDoc('q1')]),
  freshQuiz: freshQuizOf(['q1']),
  attempts: [],
  students: [],
  guests: [],
  guestAttempts: [],
  isAdmin: false,
  ...overrides,
});

describe('collectUserResponses', () => {
  it('builds one row per question with stored verdicts and label+text answers', async () => {
    const result = await collect({
      quiz: populatedQuiz([
        questionDoc('q1'),
        questionDoc('q2', { questionType: 'numerical', options: [], correctAnswer: 4 }),
      ]),
      freshQuiz: freshQuizOf(['q1', 'q2']),
      attempts: [attemptDoc('att1', [
        { questionIndex: 0, questionId: 'q1', selectedAnswer: 1, isCorrect: true, timeSpent: 30 },
        { questionIndex: 1, questionId: 'q2', selectedAnswer: 5, isCorrect: false, timeSpent: 10 },
      ])],
      students: [studentRow('att1')],
    });

    expect(result.attemptCount).toBe(1);
    expect(result.participantCount).toBe(1);
    expect(result.responseRowCount).toBe(2);
    expect(result.missingQuestionCount).toBe(0);
    expect(result.marking).toEqual({ positiveMarks: 4, negativeMarks: 1 });

    const [block] = result.attempts;
    expect(block.attemptId).toBe('att1');
    expect(block.participantType).toBe('Registered');
    expect(block.studentPhone).toBe('+919800000001');
    // Attempt totals are the Student Performance row's values, not recomputed.
    expect(block.marksObtained).toBe(4);
    expect(block.scorePercentage).toBe(50);

    const [correct, incorrect] = block.rows;
    expect(correct.result).toBe('correct');
    expect(correct.studentResponseLabel).toBe('B');
    expect(correct.studentResponseText).toBe('Mitochondria');
    expect(correct.correctAnswerLabel).toBe('B');
    expect(correct.marks).toBe(4);

    expect(incorrect.result).toBe('incorrect');
    expect(incorrect.studentResponseLabel).toBe('5');
    expect(incorrect.correctAnswerText).toBe('4');
    expect(incorrect.marks).toBe(-1);
  });

  it('classifies skipped questions explicitly — including missing answer docs and empty multi-selects', async () => {
    // No answer doc at all for q1 (never opened), legacy -1 for q2, empty
    // array for q3 — all three are skips under the type-aware contract.
    const result = await collect({
      quiz: populatedQuiz([
        questionDoc('q1'),
        questionDoc('q2'),
        questionDoc('q3', { questionType: 'multiple_correct', correctAnswer: [0, 1] }),
      ]),
      freshQuiz: freshQuizOf(['q1', 'q2', 'q3']),
      attempts: [attemptDoc('att1', [
        { questionIndex: 1, questionId: 'q2', selectedAnswer: -1, isCorrect: false },
        { questionIndex: 2, questionId: 'q3', selectedAnswer: [], isCorrect: false },
      ], { totalQuestions: 3 })],
      students: [studentRow('att1', { skipped: 3 })],
    });

    const results = result.attempts[0].rows.map((r) => r.result);
    expect(results).toEqual(['skipped', 'skipped', 'skipped']);
    expect(result.attempts[0].rows.every((r) => r.resultLabel === 'Skipped')).toBe(true);
    expect(result.attempts[0].rows.every((r) => r.marks === 0)).toBe(true);
  });

  it('treats numerical 0 as an answered selection, not a skip', async () => {
    const result = await collect({
      quiz: populatedQuiz([questionDoc('q1', { questionType: 'numerical', options: [], correctAnswer: 0 })]),
      freshQuiz: freshQuizOf(['q1']),
      attempts: [attemptDoc('att1', [
        { questionIndex: 0, questionId: 'q1', selectedAnswer: 0, isCorrect: true },
      ], { totalQuestions: 1 })],
      students: [studentRow('att1')],
    });

    expect(result.attempts[0].rows[0]).toMatchObject({
      result: 'correct',
      studentResponseLabel: '0',
      correctAnswerLabel: '0',
    });
  });

  it('pairs answers by questionId and falls back to questionIndex for legacy answers', async () => {
    // q1's answer is legacy (created before answer.questionId existed) so it
    // resolves via its index; q2 pairs by questionId. Same resolution order
    // as the single-attempt report (id first, index only as legacy fallback).
    const result = await collect({
      quiz: populatedQuiz([questionDoc('q1'), questionDoc('q2')]),
      freshQuiz: freshQuizOf(['q1', 'q2']),
      attempts: [attemptDoc('att1', [
        { questionIndex: 0, selectedAnswer: 1, isCorrect: true },
        { questionIndex: 1, questionId: 'q2', selectedAnswer: 2, isCorrect: false },
      ])],
      students: [studentRow('att1')],
    });

    const [row1, row2] = result.attempts[0].rows;
    expect(row1.studentResponseText).toBe('Mitochondria');
    expect(row1.result).toBe('correct');
    expect(row2.studentResponseText).toBe('Ribosome');
    expect(row2.result).toBe('incorrect');
  });

  it('marks deleted questions honestly while keeping the stored verdict', async () => {
    // The fresh quiz still lists q2 (raw id) but only q1's doc survives in
    // the bank — populate omits the dead ref, identity pairing keeps the
    // slot, and the row reports the question as unavailable.
    const result = await collect({
      quiz: populatedQuiz([questionDoc('q1')]),
      freshQuiz: freshQuizOf(['q1', 'q2']),
      attempts: [attemptDoc('att1', [
        { questionIndex: 0, questionId: 'q1', selectedAnswer: 1, isCorrect: true },
        { questionIndex: 1, questionId: 'q2', selectedAnswer: 0, isCorrect: false, metadataSnapshot: { subjectName: 'Pathology' } },
      ])],
      students: [studentRow('att1')],
    });

    const [row1, row2] = result.attempts[0].rows;
    expect(row1.questionUnavailable).toBe(false);
    expect(row2.questionUnavailable).toBe(true);
    expect(row2.result).toBe('incorrect');
    expect(row2.correctAnswerText).toBe('');
    expect(result.missingQuestionCount).toBe(1);
  });

  it('numbers retake attempts chronologically without merging their responses', async () => {
    const student = { name: 'Student One', email: 'one@example.com', phone: '' };
    const first = attemptDoc('att1', [
      { questionIndex: 0, questionId: 'q1', selectedAnswer: 0, isCorrect: false },
    ], { totalQuestions: 1, student });
    const retake = attemptDoc('att2', [
      { questionIndex: 0, questionId: 'q1', selectedAnswer: 1, isCorrect: true },
    ], { totalQuestions: 1, student });

    const result = await collect({
      quiz: populatedQuiz([questionDoc('q1')]),
      freshQuiz: freshQuizOf(['q1']),
      attempts: [retake, first], // loader order need not be chronological
      students: [
        studentRow('att1', { rank: 2, completedAt: new Date('2026-10-01T10:00:00Z') }),
        studentRow('att2', { rank: 1, completedAt: new Date('2026-10-05T10:00:00Z') }),
      ],
    });

    expect(result.attemptCount).toBe(2);
    expect(result.participantCount).toBe(1); // same student, two attempts
    const numbers = result.attempts.map((b) => b.attemptNumber);
    expect(numbers).toEqual([1, 2]); // blocks keep sheet-1 order, numbering is chronological
    const responses = result.attempts.map((b) => b.rows[0].result);
    expect(responses).toEqual(['incorrect', 'correct']);
  });

  it('appends guest blocks after registered ones with snapshot identity (admin only)', async () => {
    const attempts = [attemptDoc('att1', [
      { questionIndex: 0, questionId: 'q1', selectedAnswer: 1, isCorrect: true },
    ], { totalQuestions: 1 })];
    const guestAttempt = {
      _id: 'gatt1',
      totalQuestions: 1,
      answers: [{ questionIndex: 0, questionId: 'q1', selectedAnswer: 1, isCorrect: true }],
    };
    const guestRow = {
      attemptId: 'gatt1',
      studentId: 'guest1',
      studentName: 'Rahul Sharma',
      studentEmail: 'rahul@example.com',
      rank: null,
      score: 1,
      marksObtained: 4,
      totalMarks: 4,
      scorePercentage: 100,
      correct: 1,
      incorrect: 0,
      skipped: 0,
      status: 'completed',
      completedAt: new Date('2026-10-02T09:00:00Z'),
      phone: '+919876543210',
    };

    const shared = {
      quiz: populatedQuiz([questionDoc('q1')]),
      freshQuiz: freshQuizOf(['q1']),
      attempts,
      students: [studentRow('att1')],
      guests: [guestRow],
      guestAttempts: [guestAttempt],
    };

    const admin = await collectUserResponses({ ...shared, isAdmin: true });
    expect(admin.attempts.map((b) => b.participantType)).toEqual(['Registered', 'Guest']);
    expect(admin.attempts[1]).toMatchObject({
      studentName: 'Rahul Sharma',
      studentPhone: '+919876543210',
      rank: null,
      marksObtained: 4,
    });
    expect(admin.attempts[1].rows[0].result).toBe('correct');
    expect(admin.participantCount).toBe(2);

    // Mentors never receive guest blocks even if rows leak in.
    const mentor = await collectUserResponses({ ...shared, isAdmin: false });
    expect(mentor.attempts.map((b) => b.participantType)).toEqual(['Registered']);
    expect(mentor.participantCount).toBe(1);
  });

  it('keeps a placeholder block when an attempt doc is missing', async () => {
    const result = await collect({
      quiz: populatedQuiz([questionDoc('q1')]),
      freshQuiz: freshQuizOf(['q1']),
      attempts: [], // the loader's row exists but its attempt vanished
      students: [studentRow('att-gone')],
    });

    expect(result.attemptCount).toBe(1);
    expect(result.attempts[0]).toMatchObject({
      attemptId: 'att-gone',
      attemptUnavailable: true,
      rows: [],
    });
    expect(result.responseRowCount).toBe(0);
  });

  it('returns an empty attempts list for tests with no responses', async () => {
    const result = await collect({ isAdmin: true });

    expect(result.attempts).toEqual([]);
    expect(result.attemptCount).toBe(0);
    expect(result.participantCount).toBe(0);
    expect(result.responseRowCount).toBe(0);
  });
});
