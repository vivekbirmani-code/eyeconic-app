// Question-level response rows for EVERY finalized attempt of a test — the
// data source for the test report workbook's "User Responses" sheet.
//
// Called from collectTestReportData with the quiz and attempt documents that
// loader already fetched (plus its rendered Student Performance rows), so the
// sheet adds no per-attempt lookups (no N+1) and its per-attempt identity
// block — rank, totals, ordering — is joined from the SAME rows the Student
// Performance sheet renders, making cross-sheet agreement structural rather
// than something to keep in sync. The one query it may run itself is the
// lean fresh-quiz fetch for the raw question-id list (see below).
//
// Per-question rows come from the shared attemptQuestionRows builder (the
// one path the single-attempt question report also uses): stored
// answer.isCorrect verdicts, type-aware answered/skipped detection,
// questionId-based pairing that tolerates deleted questions, and
// label+text rendering for every supported question type.
const Quiz = require('../models/Quiz');
const QuestionBank = require('../models/QuestionBank');
const { buildAttemptQuestionRows } = require('./attemptQuestionRows');

const markingOf = (quiz) => ({
  positiveMarks: Number.isFinite(Number(quiz.positiveMarks)) ? Number(quiz.positiveMarks) : 4,
  negativeMarks: Number.isFinite(Number(quiz.negativeMarks)) ? Math.abs(Number(quiz.negativeMarks)) : 1,
});

// Chronological attempt numbers per participant (retakes read as Attempt 1,
// Attempt 2…). Numbering never reorders blocks — the sheet keeps the Student
// Performance ordering (rank, then guests).
const attemptNumbersBy = (participantRows) => {
  const attemptsByParticipant = new Map();
  participantRows.forEach((row) => {
    const key = row.studentId || `attempt:${row.attemptId}`;
    if (!attemptsByParticipant.has(key)) attemptsByParticipant.set(key, []);
    attemptsByParticipant.get(key).push({
      attemptId: String(row.attemptId),
      submittedAt: row.completedAt || row.startedAt || null,
    });
  });
  const attemptNumberById = new Map();
  attemptsByParticipant.forEach((list) => {
    [...list]
      .sort((a, b) => (new Date(a.submittedAt || 0)) - (new Date(b.submittedAt || 0)))
      .forEach((entry, index) => {
        attemptNumberById.set(entry.attemptId, index + 1);
      });
  });
  return { attemptNumberById, participantCount: attemptsByParticipant.size };
};

/**
 * Collects the User Responses payload for a test report.
 *
 * @param {object} params
 * @param {object} params.quiz  loaded Quiz doc (questions populated) — the
 *   same doc collectTestReportData used; subjects are populated here, AFTER
 *   the shared aggregates were computed, because populating earlier would
 *   change the question-wise subject fallback of the existing sheets
 * @param {object} [params.freshQuiz] optional UNPOPULATED quiz doc (raw
 *   question ids + sections + marking) — the pairing source of truth, loaded
 *   here when omitted (same fresh-quiz pattern as the single-attempt report;
 *   the populated doc cannot serve because populate omits deleted refs)
 * @param {object[]} params.attempts registered attempt docs (student
 *   populated with name/email/phone)
 * @param {object[]} params.students Student Performance rows for the
 *   registered attempts (rank + totals, keyed by attemptId)
 * @param {object[]} params.guests Student Performance guest rows (admin
 *   only; identity is snapshot-first per fetchGuestParticipants)
 * @param {object[]} [params.guestAttempts] lean GuestAttempt docs with
 *   answers + identity snapshots (admin only)
 * @param {boolean} params.isAdmin whether the caller is an admin (guests are
 *   admin-only data everywhere else and here too)
 * @returns {{ attempts: object[], attemptCount: number, participantCount:
 *   number, responseRowCount: number, missingQuestionCount: number,
 *   marking: {positiveMarks: number, negativeMarks: number} }}
 */
async function collectUserResponses({
  quiz,
  freshQuiz = null,
  attempts,
  students,
  guests,
  guestAttempts = [],
  isAdmin,
}) {
  const participantRows = [...students, ...(isAdmin ? guests : [])];
  const { attemptNumberById, participantCount } = attemptNumbersBy(participantRows);

  // Shared identity block: every field but the rows comes from the Student
  // Performance row (joined by attemptId), so the two sheets cannot disagree
  // on rank, totals or status for the same attempt.
  const blockFrom = (row, participantType, attempt) => ({
    attemptId: String(row.attemptId),
    participantType,
    studentName: row.studentName,
    studentEmail: attempt?.student?.email ?? row.studentEmail ?? '',
    // Registered phones come from the user profile (mentors already see
    // their assigned students' phones in-app; the export cohort is the same
    // mentor-scoped set). Guest phones ride via the admin-only lead column.
    studentPhone: participantType === 'Guest' ? (row.phone || '') : (attempt?.student?.phone || ''),
    rank: row.rank ?? null,
    attemptNumber: attemptNumberById.get(String(row.attemptId)) || 1,
    score: row.score,
    marksObtained: row.marksObtained,
    totalMarks: row.totalMarks,
    scorePercentage: row.scorePercentage,
    correct: row.correct,
    incorrect: row.incorrect,
    skipped: row.skipped,
    submittedAt: row.completedAt || null,
    status: row.status || '',
    attempt,
  });

  const attemptById = new Map(attempts.map((a) => [String(a._id), a]));
  const guestAttemptById = new Map(guestAttempts.map((a) => [String(a._id), a]));

  const blocks = [
    ...students.map((row) => blockFrom(row, 'Registered', attemptById.get(String(row.attemptId)))),
    // Guest blocks ride after the registered ones — admin only (the guests
    // array is empty for mentors by construction).
    ...(isAdmin ? guests.map((row) => blockFrom(row, 'Guest', guestAttemptById.get(String(row.attemptId)))) : []),
  ];

  // Authoritative question-id list/order for answer pairing. The populated
  // quiz carries docs (deleted refs silently omitted by populate), so the
  // raw ids come from one lean fresh fetch — identical to the
  // attemptQuestionReport collector's freshQuiz.
  const quizForIds = freshQuiz
    || await Quiz.findById(quiz._id).select('questions sections positiveMarks negativeMarks').lean();

  // Quiz vanished between the loader's read and here: blocks keep their
  // identity/totals but honestly report their rows as unavailable instead of
  // crashing the export.
  if (!quizForIds) {
    return {
      attempts: blocks.map((block) => ({ ...block, rows: [], missingQuestionCount: 0, attemptUnavailable: true })),
      attemptCount: blocks.length,
      participantCount,
      responseRowCount: 0,
      missingQuestionCount: 0,
      marking: markingOf(quiz),
    };
  }

  const marking = markingOf(quizForIds);

  // Subjects must be populated on each question for the row subject columns.
  // See the JSDoc note for why this happens only here, after the shared
  // aggregates have consumed the unpopulated docs.
  if (quiz.questions && quiz.questions.length > 0
    && !quiz.questions[0]?.subject?.name) {
    await QuestionBank.populate(quiz.questions, { path: 'subject', select: 'name' });
  }

  const outBlocks = [];
  let missingQuestionCount = 0;
  let responseRowCount = 0;

  blocks.forEach((block) => {
    // Attempts whose doc vanished between the loader's query and here still
    // keep their block with an explicit placeholder instead of silently
    // disappearing.
    if (!block.attempt) {
      outBlocks.push({ ...block, rows: [], missingQuestionCount: 0, attemptUnavailable: true });
      return;
    }
    const { questions, missingQuestionCount: blockMissing } = buildAttemptQuestionRows({
      attempt: block.attempt,
      freshQuiz: quizForIds,
      populatedQuestions: quiz.questions || [],
      positiveMarks: marking.positiveMarks,
      negativeMarks: marking.negativeMarks,
    });
    missingQuestionCount += blockMissing;
    responseRowCount += questions.length;
    outBlocks.push({ ...block, rows: questions, missingQuestionCount: blockMissing });
  });

  return {
    attempts: outBlocks,
    attemptCount: outBlocks.length,
    participantCount,
    responseRowCount,
    missingQuestionCount,
    marking,
  };
}

module.exports = { collectUserResponses };
