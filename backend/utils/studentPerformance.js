const mongoose = require('mongoose');
const QuizAttempt = require('../models/QuizAttempt');
const User = require('../models/User');
const {
  aggregateStudentSummary,
  computeAttemptStats,
  computeTrend,
  computeInsights,
  aggregateSubjectStats,
  filterAttemptsByDateRange,
} = require('./analytics');
const { getFrequentlyMissedQuestions } = require('./questionHistory');

const DEFAULT_HISTORY_PAGE_SIZE = 20;
const DEFAULT_MISSED_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

function mapAttemptSummary(attempt) {
  const stats = computeAttemptStats(attempt);
  return {
    _id: attempt._id,
    quiz: attempt.quiz,
    score: attempt.score,
    totalQuestions: stats.totalQuestions,
    marksObtained: stats.marksObtained,
    totalMarks: stats.totalMarks,
    scorePercentage: stats.scorePercentage,
    accuracy: stats.accuracy,
    correct: stats.correct,
    incorrect: stats.incorrect,
    skipped: stats.skipped,
    attempted: stats.attempted,
    percentage: stats.percentage,
    endTime: attempt.endTime,
    tabSwitchCount: attempt.tabSwitchCount || 0,
  };
}

/**
 * Build a paginated student performance payload used by analytics endpoints.
 *
 * `allowedRoles` gates which user records may be profiled. Defaults to
 * students only (the admin/mentor → /analytics/student/:studentId path);
 * the self-service /analytics/me route passes its own authorized roles so a
 * mentor can view their own (test-taking) history.
 */
async function buildStudentPerformanceResponse(studentId, options = {}) {
  const {
    range,
    page = 1,
    limit = DEFAULT_HISTORY_PAGE_SIZE,
    missedPage = 1,
    missedLimit = DEFAULT_MISSED_PAGE_SIZE,
    minIncorrectAttempts,
    includeInsights = false,
    includeSubjectWise = false,
    allowedRoles = ['student'],
  } = options;

  const pageNum = parsePositiveInt(page, 1);
  const pageSize = parsePositiveInt(limit, DEFAULT_HISTORY_PAGE_SIZE);
  const missedPageNum = parsePositiveInt(missedPage, 1);
  const missedPageSize = parsePositiveInt(missedLimit, DEFAULT_MISSED_PAGE_SIZE);
  const missedSkip = (missedPageNum - 1) * missedPageSize;

  if (!mongoose.Types.ObjectId.isValid(String(studentId))) {
    const error = new Error('Invalid student id');
    error.statusCode = 400;
    throw error;
  }

  const student = await User.findById(studentId).select('name email profilePicture role').lean();
  if (!student || !allowedRoles.includes(student.role)) {
    const error = new Error('Student not found');
    error.statusCode = 404;
    throw error;
  }

  let attempts = await QuizAttempt.find({
    student: studentId,
    status: { $in: ['completed', 'auto_submitted'] },
  })
    .populate('quiz', 'title subject testType totalMarks')
    .sort({ endTime: -1 });

  attempts = filterAttemptsByDateRange(attempts, range);

  const summary = aggregateStudentSummary(attempts);
  const trend = computeTrend(attempts);
  const subjectStats = includeSubjectWise ? aggregateSubjectStats(attempts) : null;

  const totalAttempts = attempts.length;
  const startIndex = (pageNum - 1) * pageSize;
  const paginatedAttempts = attempts.slice(startIndex, startIndex + pageSize);

  const frequentlyMissedResult = await getFrequentlyMissedQuestions(studentId, {
    minIncorrectAttempts,
    limit: missedPageSize,
    skip: missedSkip,
    includeTotal: true,
  });

  const payload = {
    student: {
      id: String(student._id),
      name: student.name,
      email: student.email,
      profilePicture: student.profilePicture || null,
    },
    summary,
    trend,
    attempts: paginatedAttempts.map(mapAttemptSummary),
    pagination: {
      page: pageNum,
      limit: pageSize,
      total: totalAttempts,
      totalPages: totalAttempts > 0 ? Math.ceil(totalAttempts / pageSize) : 0,
      showingFrom: totalAttempts > 0 ? startIndex + 1 : 0,
      showingTo: totalAttempts > 0 ? Math.min(startIndex + pageSize, totalAttempts) : 0,
    },
    frequentlyMissedQuestions: frequentlyMissedResult.items,
    frequentlyMissedPagination: {
      page: missedPageNum,
      limit: missedPageSize,
      total: frequentlyMissedResult.total,
      totalPages: frequentlyMissedResult.total > 0
        ? Math.ceil(frequentlyMissedResult.total / missedPageSize)
        : 0,
    },
  };

  if (includeSubjectWise) {
    const subjectWise = {};
    (subjectStats || []).forEach((subject) => {
      subjectWise[subject.subjectId] = {
        tests: subject.tests,
        totalMarks: subject.totalMarks,
        obtainedMarks: subject.obtainedMarks,
      };
    });
    payload.subjectWise = subjectWise;
  }

  if (includeInsights) {
    payload.insights = computeInsights({
      attempts,
      summary,
      subjectStats: subjectStats || aggregateSubjectStats(attempts),
    });
  }

  return payload;
}

module.exports = {
  buildStudentPerformanceResponse,
  mapAttemptSummary,
  DEFAULT_HISTORY_PAGE_SIZE,
  DEFAULT_MISSED_PAGE_SIZE,
};
