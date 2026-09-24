const express = require('express');
const mongoose = require('mongoose');
const { auth, authorize } = require('../middleware/auth');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const QuestionBank = require('../models/QuestionBank');
const miniCct = require('../utils/miniCct');
const { dedupeLatestAttemptPerStudent } = require('../utils/cohortComparison');
const { roundTo2 } = require('../utils/analytics');

const router = express.Router();

/**
 * Mini CCT (Mini Grand Test) — 30 questions, 10 each from Psychiatry,
 * Dermatology and Orthopaedics, generated from the Question Bank as a shared
 * `testType: 'mini'` Quiz and taken through the NORMAL quiz engine
 * (POST /api/quizzes/:id/start → autosave → submit). A fixed shared test is
 * what makes the "database average" and percentile meaningful.
 *
 * This router adds only what the engine does not have:
 *  - GET  /latest                      dashboard card payload
 *  - GET  /attempts                    own Mini CCT attempt history
 *  - GET  /attempts/:attemptId/analysis  the post-submission analysis
 *    dashboard (subject radar/comparison vs the database average, percentile,
 *    tier, topic & concept-tag breakdowns; gated server-side for free users)
 *  - POST /generate                    admin: assemble the next Mini CCT
 *
 * Mounted ungated like /api/quizzes and /api/daily-pyq: part of the quiz
 * ecosystem (featureAvailability `quizzes: true`), standard JWT auth per
 * route, no new auth mechanism.
 */

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

const ATTEMPT_PROJECTION =
  'quiz student status startTime endTime score totalQuestions marksObtained totalMarks ' +
  'answers.questionIndex answers.questionId answers.selectedAnswer answers.isCorrect ' +
  'answers.markedForReview answers.timeSpent answers.metadataSnapshot';

const COHORT_PROJECTION =
  'student endTime marksObtained totalMarks ' +
  'answers.questionIndex answers.selectedAnswer answers.isCorrect answers.metadataSnapshot';

const HISTORY_PAGE_DEFAULT = 1;
const HISTORY_LIMIT_DEFAULT = 10;
const HISTORY_LIMIT_MAX = 50;

function parseHistoryQuery(query) {
  const page = Number.parseInt(query.page, 10);
  const limit = Number.parseInt(query.limit, 10);
  return {
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 1000) : HISTORY_PAGE_DEFAULT,
    limit: Number.isFinite(limit) && limit >= 1
      ? Math.min(limit, HISTORY_LIMIT_MAX)
      : HISTORY_LIMIT_DEFAULT,
  };
}

/**
 * Mini CCTs are SELF-SERVE: every authenticated student sees the latest one
 * from the dashboard — individual assignment is never required (mirrors the
 * `testType === 'mini'` clause in the quizzes list/detail/start routes).
 */

/** Newest attempt (any status) by this student on this quiz, for the card. */
async function attemptStatusFor(quizId, studentId) {
  const attempt = await QuizAttempt.findOne({ quiz: quizId, student: studentId })
    .select('status marksObtained totalMarks score totalQuestions endTime retestRequested retestApproved retestUsed')
    .sort({ startTime: -1, _id: -1 });
  if (!attempt) {
    return { hasAttempted: false, canRetake: false, retestRequested: false };
  }
  const finalized = attempt.status === 'completed' || attempt.status === 'auto_submitted';
  return {
    hasAttempted: true,
    attemptId: attempt._id,
    status: attempt.status,
    marksObtained: roundTo2(attempt.marksObtained),
    totalMarks: attempt.totalMarks,
    score: attempt.score,
    totalQuestions: attempt.totalQuestions,
    endTime: attempt.endTime,
    canRetake: Boolean(attempt.retestApproved && !attempt.retestUsed),
    retestRequested: Boolean(attempt.retestRequested && !attempt.retestApproved),
  };
}

// ── GET /latest — the dashboard card payload ────────────────────────────────

router.get('/latest', auth, authorize('student'), async (req, res) => {
  try {
    // Newest active Mini CCT — visible to every student (self-serve).
    const quiz = await Quiz.findOne({
      testType: miniCct.MINI_CCT_TEST_TYPE,
      isActive: true,
      isDeleted: { $ne: true },
    })
      .select('title testType duration totalMarks positiveMarks negativeMarks scheduledDate expiryDate assignToAllFreeUsers assignedStudents questions createdAt')
      .sort({ createdAt: -1, _id: -1 });

    if (!quiz) {
      return res.json({ quiz: null });
    }

    const questions = await QuestionBank.find({ _id: { $in: quiz.questions } })
      .select('subject')
      .populate('subject', 'name');
    // Subject names in the QUIZ's question order (Psychiatry → Dermatology →
    // Orthopaedics), not the find()'s _id order.
    const subjectByQuestion = new Map(questions.map((q) => [q._id.toString(), q.subject]));
    const subjectNames = [];
    const seen = new Set();
    quiz.questions.forEach((id) => {
      const subject = subjectByQuestion.get(id.toString());
      const name = subject && subject.name ? miniCct.normalizeLabel(subject.name) : null;
      if (name && !seen.has(name)) {
        seen.add(name);
        subjectNames.push(name);
      }
    });

    res.json({
      quiz: {
        _id: quiz._id,
        title: quiz.title,
        testType: quiz.testType,
        duration: quiz.duration,
        totalMarks: quiz.totalMarks,
        positiveMarks: quiz.positiveMarks,
        negativeMarks: quiz.negativeMarks,
        scheduledDate: quiz.scheduledDate || null,
        expiryDate: quiz.expiryDate || null,
        questionCount: quiz.questions.length,
        subjectNames,
        createdAt: quiz.createdAt,
        attemptStatus: await attemptStatusFor(quiz._id, req.user._id),
      },
    });
  } catch (error) {
    console.error('[mini-cct] GET /latest error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /attempts — own finalized Mini CCT history ──────────────────────────

router.get('/attempts', auth, authorize('student'), async (req, res) => {
  try {
    const { page, limit } = parseHistoryQuery(req.query);

    const miniQuizzes = await Quiz.find({
      testType: miniCct.MINI_CCT_TEST_TYPE,
      isDeleted: { $ne: true },
    }).select('_id title');
    const quizById = new Map(miniQuizzes.map((q) => [q._id.toString(), q]));

    const filter = {
      student: req.user._id,
      status: { $in: miniCct.FINALIZED_STATUSES },
      quiz: { $in: [...quizById.keys()].map((id) => new mongoose.Types.ObjectId(id)) },
    };

    const [total, attempts] = await Promise.all([
      QuizAttempt.countDocuments(filter),
      QuizAttempt.find(filter)
        .select('quiz status endTime score totalQuestions marksObtained totalMarks')
        .sort({ endTime: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
    ]);

    res.json({
      attempts: attempts.map((attempt) => ({
        _id: attempt._id,
        quizId: attempt.quiz,
        quizTitle: (quizById.get(String(attempt.quiz)) || {}).title || 'Mini CCT',
        status: attempt.status,
        score: attempt.score,
        correct: attempt.score,
        totalQuestions: attempt.totalQuestions,
        marksObtained: roundTo2(attempt.marksObtained),
        totalMarks: attempt.totalMarks,
        endTime: attempt.endTime,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('[mini-cct] GET /attempts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /attempts/:attemptId/analysis — the analysis dashboard ─────────────

router.get('/attempts/:attemptId/analysis', auth, authorize('student'), async (req, res) => {
  try {
    const { attemptId } = req.params;
    if (!OBJECT_ID_RE.test(attemptId)) {
      return res.status(400).json({ message: 'Invalid attempt id', code: 'VALIDATION_ERROR' });
    }

    // Ownership is the query itself — a student can never load anyone else's
    // attempt, and mentors/admins use their own analytics surfaces instead.
    const attempt = await QuizAttempt.findOne({ _id: attemptId, student: req.user._id })
      .select(ATTEMPT_PROJECTION);
    if (!attempt) {
      return res.status(404).json({ message: 'Attempt not found', code: 'ATTEMPT_NOT_FOUND' });
    }

    const quiz = await Quiz.findById(attempt.quiz);
    if (!quiz || quiz.testType !== miniCct.MINI_CCT_TEST_TYPE) {
      return res.status(404).json({ message: 'Not a Mini CCT attempt', code: 'NOT_MINI_CCT' });
    }
    if (!miniCct.FINALIZED_STATUSES.includes(attempt.status)) {
      return res.status(400).json({
        message: 'Analysis is available after you submit the test.',
        code: 'ATTEMPT_NOT_COMPLETED',
      });
    }

    const questions = await QuestionBank.find({ _id: { $in: quiz.questions } })
      .select('questionType topicName subject tags')
      .populate('subject', 'name');
    // Restore the quiz's frozen question order — analytics rows follow it.
    const byId = new Map(questions.map((q) => [q._id.toString(), q]));
    const orderedQuestions = quiz.questions
      .map((id) => byId.get(id.toString()))
      .filter(Boolean);

    // The "database average": every student's latest finalized attempt on THIS
    // Mini CCT, deduped per student (approved retests never double-weight).
    const cohortAttempts = await QuizAttempt.find({
      quiz: quiz._id,
      status: { $in: miniCct.FINALIZED_STATUSES },
    }).select(COHORT_PROJECTION);
    const cohort = dedupeLatestAttemptPerStudent(cohortAttempts);

    const analysis = miniCct.buildMiniCctAnalysis({
      attempt,
      quiz,
      questions: orderedQuestions,
      cohort,
    });

    res.json(miniCct.applyAnalysisAccess(analysis, { isFreeUser: req.user.isFreeUser === true }));
  } catch (error) {
    console.error('[mini-cct] GET /attempts/:id/analysis error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /generate — admin: assemble the next Mini CCT from the bank ───────

router.post('/generate', auth, authorize('admin'), async (req, res) => {
  try {
    const { title, duration, scheduledDate, expiryDate } = req.body || {};

    const result = await miniCct.createMiniCctQuiz({
      adminId: req.user._id,
      title,
      duration,
      scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
      expiryDate: expiryDate ? new Date(expiryDate) : undefined,
      onCreated: async ({ quiz, studentIds }) => {
        // Parity with POST /api/quizzes/create-from-bank: socket badge + push
        // notification (unseenQuizzes was already written by the creator).
        const io = req.app.get('io');
        if (io) {
          io.emit('new_quiz_assigned', {
            quizId: quiz._id,
            title: quiz.title,
            assignedStudents: studentIds,
          });
        }
        const User = require('../models/User');
        const { sendPushToUser } = require('../utils/notifications');
        const recipients = await User.find({
          _id: { $in: studentIds },
          $or: [{ pushToken: { $ne: null } }, { fcmToken: { $ne: null } }],
        }).select('_id pushToken fcmToken');
        await Promise.allSettled(
          recipients.map((student) =>
            sendPushToUser({
              expoPushToken: student.pushToken,
              fcmToken: student.fcmToken,
              title: 'New Mini CCT',
              body: `${quiz.title} is ready — 30 questions, 3 subjects`,
              data: {
                type: 'quiz_assigned',
                quizId: quiz._id.toString(),
                quizTitle: quiz.title,
                testType: quiz.testType,
              },
            })
          )
        );
      },
    });

    if (result.error) {
      const { status, ...body } = result.error;
      return res.status(status).json(body);
    }

    res.status(201).json({
      message: 'Mini CCT created successfully',
      quizId: result.quiz._id,
      title: result.quiz.title,
      questionCount: result.questionCount,
      perSubject: result.perSubject,
    });
  } catch (error) {
    console.error('[mini-cct] POST /generate error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
