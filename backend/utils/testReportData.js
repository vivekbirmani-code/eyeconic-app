// Shared data collection for the test report exports (CSV + Excel). Both
// formats MUST stay data-identical, so the queries, mentor scoping and every
// derived value live here — the routes only render. Aggregates come from
// utils/analytics.js computeTestAnalytics, the SAME single source the app's
// Test Analytics route uses, so exports and UI can never show different
// numbers. Registered-student exports are unchanged; admin exports also
// count public-guest attempts in every aggregate.
//
// optionLabelFromIndex/optionTextFromIndex are intentionally duplicated from
// routes/quizzes.js + utils/attemptResults.js (same convention as roundTo2
// there) to keep this module standalone — keep all copies in sync.
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const MentorStudentAssignment = require('../models/MentorStudentAssignment');
const {
  roundTo2,
  computeTestAnalytics,
  rankStudentAttempts,
} = require('./analytics');
const { fetchGuestParticipants, fetchGuestAttemptDocs } = require('./guestAnalytics');
const { buildProctoringSummary } = require('./proctoring/summary');
const { collectUserResponses } = require('./userResponsesReport');

// Phase 7 (§25.2) proctoring export columns. Empty strings for non-proctored
// attempts and guests (proctoring is registered-only in V1) — the historical
// CSV convention for absent values.
const EMPTY_PROCTORING_COLUMNS = {
  riskCategory: '',
  totalViolations: '',
  focusLossExits: '',
  multipleFaceEvents: '',
  faceAbsentTotal: '',
  cameraIncidents: '',
  heartbeatGaps: '',
};

const optionLabelFromIndex = (index) => {
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0) return '';
  return String.fromCharCode(65 + idx); // 0 -> A, 1 -> B, ...
};

const optionTextFromIndex = (options, index) => {
  const idx = Number(index);
  if (!Array.isArray(options) || !Number.isInteger(idx) || idx < 0 || idx >= options.length) {
    return '';
  }
  return options[idx] || '';
};

const buildSectionBreakdown = (sectionPerformance) =>
  Array.isArray(sectionPerformance) && sectionPerformance.length > 0
    ? sectionPerformance
        .map((section) => {
          const sectionName = section.sectionName || 'Section';
          return `${sectionName} (C:${section.correct || 0}, W:${section.incorrect || 0}, S:${section.skipped || 0}, Acc:${roundTo2(section.accuracy || 0)}%)`;
        })
        .join(' | ')
    : '';

const rawDurationMinutes = (start, end) =>
  start && end
    ? Math.max(0, (new Date(end) - new Date(start)) / 1000 / 60)
    : 0;

// Per-row display value. NOTE: aggregate metrics must sum rawDurationMinutes
// and round only the final average (the historical CSV behavior) — summing
// pre-rounded values drifts the average (1s + 3s attempts: 0.03 vs 0.04).
const attemptDurationMinutes = (start, end) => roundTo2(rawDurationMinutes(start, end));

/**
 * Collects every number/row the test report exports need.
 *
 * Mentor scoping, ranking and guest handling follow the historical CSV
 * contract: ranked registered students first (sorted by marks, percentile
 * against the scoped cohort), then unranked public-quiz guests with lead
 * columns — admins only.
 *
 * @param {object} params
 * @param {string} params.testId quiz id from the route
 * @param {object} params.user authenticated req.user (role drives scoping)
 * @param {boolean} [params.includeUserResponses] also collect the per-question
 *   response rows for every attempt (the Excel export's User Responses
 *   sheet). Costs nothing on the CSV/JSON paths, which never ask for it.
 * @returns {Promise<object|null>} report payload, or null when the quiz does
 *   not exist
 */
async function collectTestReportData({ testId, user, includeUserResponses = false }) {
  const quiz = await Quiz.findById(testId)
    .populate('subject', 'name')
    .populate('questions');
  if (!quiz) return null;

  const attemptQuery = {
    quiz: testId,
    status: { $in: ['completed', 'auto_submitted'] },
  };

  let totalAssigned = quiz.assignedStudents?.length || 0;

  if (user.role === 'mentor') {
    const assignments = await MentorStudentAssignment.find({
      mentor: user._id,
      isActive: true,
    }).select('student');
    const mentorStudentIds = assignments.map((a) => a.student.toString());
    attemptQuery.student = { $in: mentorStudentIds };

    if (quiz.assignedStudents && quiz.assignedStudents.length > 0) {
      totalAssigned = quiz.assignedStudents.filter((id) =>
        mentorStudentIds.includes(id.toString())
      ).length;
    } else {
      totalAssigned = mentorStudentIds.length;
    }
  }

  const attempts = await QuizAttempt.find(attemptQuery).populate(
    'student',
    // phone feeds only the User Responses sheet — mentors already see their
    // assigned students' phones in-app (mentor-students route), so the field
    // rides along for every exporter without changing existing outputs.
    'name email phone profilePicture'
  );

  // Public participants are first-class attempts for admins: guest attempts
  // join every aggregate through the SAME computeTestAnalytics call the app's
  // Test Analytics screen uses, so exports can never show different KPIs than
  // the app. Mentor exports stay registered-only — guest leads are admin-only
  // data (mentors don't receive guest rows or lead columns either).
  const isAdmin = user.role === 'admin';
  const guestAttempts = isAdmin ? await fetchGuestAttemptDocs(testId) : [];

  const { overview, performanceMetrics, questionAnalytics } = computeTestAnalytics(
    [...attempts, ...guestAttempts],
    quiz.questions,
    { totalAssigned, registeredCount: attempts.length }
  );

  // Ranked registered students (guests never join the leaderboard). Ranking
  // and per-row stats come from the shared rankStudentAttempts — the same
  // rows the app's Student Performance section renders.
  const ranked = rankStudentAttempts(attempts, quiz.questions);
  const sortedByMarks = [...attempts].sort(
    (a, b) => (b.marksObtained || 0) - (a.marksObtained || 0)
  );
  const total = sortedByMarks.length;
  const attemptById = new Map(attempts.map((a) => [String(a._id), a]));

  // Phase 7 (§25.2): per-attempt proctoring columns from the SAME rollup the
  // app's analytics block uses — CSV and Excel render these rows verbatim, so
  // the three surfaces cannot drift.
  const proctoring = await buildProctoringSummary(attempts.map((a) => a._id));
  const proctoringByAttempt = new Map(
    proctoring.attempts.map((row) => [row.attemptId, row])
  );
  const proctoringColumnsFor = (attemptId) => {
    const row = proctoringByAttempt.get(String(attemptId));
    if (!row) return EMPTY_PROCTORING_COLUMNS;
    return {
      riskCategory: row.riskCategory,
      totalViolations: row.totalViolations,
      focusLossExits: row.focusLossExits,
      multipleFaceEvents: row.multipleFaceEvents,
      faceAbsentTotal: row.faceAbsentTotal,
      cameraIncidents: row.cameraIncidents,
      heartbeatGaps: row.heartbeatGaps,
    };
  };

  const students = ranked.map((entry, idx) => {
    const attempt = attemptById.get(String(entry._id));
    // Percentile relative to the registered cohort (guests are unranked and
    // never a denominator).
    const belowCount = sortedByMarks.filter(
      (s) => (s.marksObtained || 0) < (attempt?.marksObtained || 0)
    ).length;

    return {
      // Shared ranking withholds rank for single-attempt tests (nothing to
      // rank against) — the export still shows the explicit position.
      rank: entry.rank ?? idx + 1,
      attemptId: String(entry._id),
      studentId: attempt?.student?._id ? String(attempt.student._id) : '',
      studentName: entry.studentName,
      studentEmail: entry.studentEmail,
      correct: entry.correct,
      incorrect: entry.incorrect,
      skipped: entry.skipped,
      answered: entry.attempted,
      totalQuestions: entry.totalQuestions,
      accuracy: entry.accuracy ?? null,
      scorePercentage: entry.scorePercentage ?? 0,
      score: roundTo2(attempt?.score || entry.correct || 0),
      marksObtained: roundTo2(entry.marksObtained || 0),
      totalMarks: roundTo2(entry.totalMarks || 0),
      percentile: total > 0 ? roundTo2((belowCount / total) * 100) : 0,
      timeSpentMinutes: attemptDurationMinutes(attempt?.startTime, attempt?.endTime),
      tabSwitchCount: attempt?.tabSwitchCount || 0,
      status: attempt?.status || '',
      startedAt: attempt?.startTime || null,
      completedAt: attempt?.endTime || null,
      sectionBreakdown: buildSectionBreakdown(attempt?.sectionPerformance),
      participantType: 'Registered',
      phone: '',
      phoneVerified: '',
      emailVerified: '',
      marketingConsent: '',
      ...proctoringColumnsFor(entry._id),
    };
  });

  // Public-quiz guests: unranked rows AFTER the registered ones, with the raw
  // lead phone + consent — admin only (mentor exports never include leads).
  const guests = isAdmin
    ? (await fetchGuestParticipants(testId, { fullPhone: true })).map((guest) => ({
        rank: null,
        attemptId: String(guest.attemptId),
        studentId: guest.guestId ? String(guest.guestId) : '',
        studentName: guest.name,
        studentEmail: guest.email || '',
        correct: guest.correct,
        incorrect: guest.incorrect,
        skipped: guest.skipped,
        answered: guest.attempted,
        totalQuestions: guest.totalQuestions,
        accuracy: guest.accuracy,
        scorePercentage: guest.scorePercentage,
        score: guest.score,
        marksObtained: guest.marksObtained,
        totalMarks: roundTo2(guest.totalMarks || 0),
        percentile: null,
        timeSpentMinutes: roundTo2((guest.timeTakenSeconds || 0) / 60),
        tabSwitchCount: guest.tabSwitchCount,
        status: guest.status || '',
        startedAt: guest.startedAt || null,
        completedAt: guest.submittedAt || null,
        sectionBreakdown: buildSectionBreakdown(guest.sectionPerformance),
        participantType: 'Guest',
        phone: guest.phone || '',
        phoneVerified: guest.phoneVerified ? 'Yes' : 'No',
        emailVerified: guest.emailVerified ? 'Yes' : 'No',
        marketingConsent: guest.marketingConsent ? 'Yes' : 'No',
        // Proctoring never applies to guest attempts (§4.4/V1 scope).
        ...EMPTY_PROCTORING_COLUMNS,
      }))
    : [];

  // Question-wise analytics come from the shared cohort above (registered +
  // guests for admins), so per-question percentages match the app exactly.
  const questions = questionAnalytics.map((q) => {
    const question = quiz.questions[q.questionNumber - 1];
    const options = Array.isArray(question?.options) ? question.options : [];
    return {
      ...q,
      subjectName: q.subjectName || quiz.subject?.name || 'General',
      topicName: q.topicName || question?.topicName || '',
      questionText: question?.question || '',
      optionA: options[0] || '',
      optionB: options[1] || '',
      optionC: options[2] || '',
      optionD: options[3] || '',
      correctOptionLabel: optionLabelFromIndex(question?.correctAnswer),
      correctOptionText: optionTextFromIndex(options, question?.correctAnswer),
      wrongCount: q.wrongCount,
    };
  });

  // User Responses payload (Excel export only). Collected AFTER the shared
  // aggregates and the questions mapping above: collectUserResponses
  // populates question subjects on the shared quiz doc, and
  // computeTestAnalytics/questionAnalytics must keep consuming the
  // unpopulated docs they have always seen (populating earlier would change
  // the question-wise subject fallback of the existing sheets). No extra
  // attempt queries — everything is joined from what this loader fetched.
  const userResponses = includeUserResponses
    ? await collectUserResponses({
        quiz,
        attempts,
        students,
        guests,
        guestAttempts,
        isAdmin,
      })
    : undefined;

  return {
    test: {
      id: String(quiz._id),
      title: quiz.title || '',
      subject: quiz.subject?.name || 'General',
      testType: quiz.testType || 'N/A',
      totalQuestions: quiz.questions.length || 0,
      totalMarks: roundTo2(quiz.totalMarks || 0),
    },
    overview: {
      totalAssigned,
      totalAttempted: overview.totalAttempted,
      // null when nothing was assigned (public test) — serialized as empty.
      completionRate: overview.completionRate,
      avgScore: overview.avgScore,
      highestScore: overview.highestScore,
      lowestScore: overview.lowestScore,
    },
    metrics: {
      avgCorrect: performanceMetrics.avgCorrect,
      avgWrong: performanceMetrics.avgWrong,
      avgSkipped: performanceMetrics.avgSkipped,
      avgTime: performanceMetrics.avgTime,
    },
    students,
    guests,
    questions,
    // Present only when the caller asked for it (Excel export) — undefined
    // keeps the CSV/JSON payload shape exactly as before.
    ...(userResponses ? { userResponses } : {}),
    // Test-level proctoring rollup (§25.2) — same source as the per-row
    // columns above and the app's analytics block.
    proctoring: proctoring.rollup,
    includeLeadColumns: isAdmin,
    generatedAt: new Date(),
  };
}

module.exports = { collectTestReportData };
