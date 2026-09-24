const express = require('express');
const mongoose = require('mongoose');
const { auth } = require('../middleware/auth');
const DailyPyqSet = require('../models/DailyPyqSet');
const DailyPyqAttempt = require('../models/DailyPyqAttempt');
const QuestionBank = require('../models/QuestionBank');
const { gradeQuestion } = require('../utils/grading');
const dailyPyq = require('../utils/dailyPyq');

const router = express.Router();

const { DAILY_QUESTION_COUNT } = dailyPyq;

// NEET PG marking, mirroring the quiz engine defaults (utils/grading skips
// are never penalised; only wrong answers lose marks).
const MARKS_CORRECT = 4;
const MARKS_INCORRECT = 1;
const MAX_TIME_TAKEN_SECONDS = 24 * 60 * 60; // sanity clamp for client-reported duration

/**
 * Daily PYQ — 10 past-question-bank questions per IST calendar day, one
 * graded attempt per student per day. The server owns everything: the frozen
 * daily set, the answer key, the grading, and the streak.
 *
 * Mounted ungated like /api/quizzes: it is part of the quiz ecosystem
 * (featureAvailability `quizzes: true`), reads only QuestionBank, and adds
 * no new auth mechanism — the standard JWT `auth` middleware applies.
 */

// ── helpers ────────────────────────────────────────────────────────────────

// SECURITY: the player payload must never carry the answer key.
function sanitizeQuestion(q) {
    const obj = q.toObject();
    delete obj.correctAnswer;
    delete obj.explanation;
    delete obj.explanationImage;
    return obj;
}

async function streakFor(studentId, todayKey) {
    const docs = await DailyPyqAttempt.find({ student: studentId }).select('date').lean();
    return dailyPyq.computeStreaks(docs.map((d) => d.date), todayKey);
}

function attemptSummary(attempt) {
    return {
        _id: attempt._id,
        date: attempt.date,
        score: attempt.score,
        maxScore: attempt.maxScore,
        correctCount: attempt.correctCount,
        incorrectCount: attempt.incorrectCount,
        skippedCount: attempt.skippedCount,
        totalQuestions: attempt.totalQuestions,
        timeTakenSeconds: attempt.timeTakenSeconds,
        submittedAt: attempt.submittedAt
    };
}

// Light in-memory limiter for submissions (pattern of otpRateLimit). The
// unique {student, date} index already caps stored attempts; this bounds
// request cost from misbehaving clients.
const submitHits = new Map(); // userId -> { count, windowStart }
const SUBMIT_WINDOW_MS = 10 * 60 * 1000;
const SUBMIT_MAX_PER_WINDOW = 15;

function submitRateLimit(req, res, next) {
    const key = req.user._id.toString();
    const now = Date.now();
    const entry = submitHits.get(key);
    if (!entry || now - entry.windowStart >= SUBMIT_WINDOW_MS) {
        submitHits.set(key, { count: 1, windowStart: now });
        return next();
    }
    entry.count += 1;
    if (entry.count > SUBMIT_MAX_PER_WINDOW) {
        return res.status(429).json({
            message: 'Too many submission attempts. Please wait a few minutes and try again.',
            code: 'RATE_LIMITED'
        });
    }
    return next();
}

// ── GET /today — the day's frozen set + this student's status ─────────────

router.get('/today', auth, async (req, res) => {
    try {
        const todayKey = dailyPyq.istDateKey();

        let set = await dailyPyq.getOrCreateDailySet(todayKey);
        if (!set || set.questionIds.length < DAILY_QUESTION_COUNT) {
            // The active bank cannot field 10 questions today.
            return res.status(503).json({
                message: 'Daily PYQ is not available right now. Please try again later.',
                code: 'DAILY_PYQ_UNAVAILABLE'
            });
        }

        // Load set questions that are still active, preserving set order.
        const active = await QuestionBank.find({
            _id: { $in: set.questionIds },
            isActive: true
        });
        const byId = new Map(active.map((q) => [q._id.toString(), q]));
        let questions = set.questionIds
            .map((id) => byId.get(id.toString()))
            .filter(Boolean);

        if (questions.length < DAILY_QUESTION_COUNT) {
            // Rare: questions were deactivated after the set froze today.
            // Regenerate only while nobody has completed the day yet, so
            // existing attempts always stay gradeable against their set.
            const attemptsExist = await DailyPyqAttempt.exists({ date: todayKey });
            if (!attemptsExist) {
                await DailyPyqSet.deleteOne({ date: todayKey });
                set = await dailyPyq.getOrCreateDailySet(todayKey);
                if (!set || set.questionIds.length < DAILY_QUESTION_COUNT) {
                    return res.status(503).json({
                        message: 'Daily PYQ is not available right now. Please try again later.',
                        code: 'DAILY_PYQ_UNAVAILABLE'
                    });
                }
                const refreshed = await QuestionBank.find({
                    _id: { $in: set.questionIds },
                    isActive: true
                });
                const refreshedById = new Map(refreshed.map((q) => [q._id.toString(), q]));
                questions = set.questionIds
                    .map((id) => refreshedById.get(id.toString()))
                    .filter(Boolean);
            }
            if (questions.length < DAILY_QUESTION_COUNT) {
                // Serve what remains; unanswered slots grade as skipped.
                // (Attempts already exist — the set must NOT change under them.)
            }
        }

        const attempt = await DailyPyqAttempt.findOne({
            student: req.user._id,
            date: todayKey
        });
        const streak = await streakFor(req.user._id, todayKey);

        return res.json({
            date: todayKey,
            serverTime: new Date().toISOString(),
            totalQuestions: set.questionIds.length,
            status: attempt ? 'completed' : 'pending',
            streak,
            // Questions are only shipped while the day is still playable —
            // a completed student receives their graded attempt instead.
            questions: attempt ? [] : questions.map(sanitizeQuestion),
            attempt: attempt ? attempt.toObject() : null
        });
    } catch (error) {
        console.error('[daily-pyq] GET /today failed:', error);
        return res.status(500).json({
            message: 'Could not load Daily PYQ. Please try again.',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ── POST /submit — server-authoritative grading, one attempt per day ──────

router.post('/submit', auth, submitRateLimit, async (req, res) => {
    try {
        const todayKey = dailyPyq.istDateKey();
        const { date, answers, timeTakenSeconds } = req.body || {};

        // A submission is only valid for the day it belongs to. A client
        // crossing midnight gets the current date back and refetches.
        if (date !== todayKey) {
            return res.status(409).json({
                message: 'This Daily PYQ has expired. Today\'s challenge has been loaded.',
                code: 'DAILY_PYQ_DATE_MISMATCH',
                currentDate: todayKey
            });
        }

        // Idempotent: double-clicks, refreshes and network retries all
        // resolve to the already-persisted authoritative attempt.
        const existing = await DailyPyqAttempt.findOne({
            student: req.user._id,
            date: todayKey
        });
        if (existing) {
            const streak = await streakFor(req.user._id, todayKey);
            return res.json({ attempt: existing.toObject(), duplicate: true, streak });
        }

        const set = await DailyPyqSet.findOne({ date: todayKey }).lean();
        if (!set || set.questionIds.length === 0) {
            return res.status(404).json({
                message: 'Today\'s Daily PYQ set was not found. Please reload.',
                code: 'DAILY_PYQ_NOT_FOUND'
            });
        }
        const setIdentifiers = new Set(set.questionIds.map((id) => id.toString()));

        // ── Input validation ────────────────────────────────────────────
        if (answers !== undefined && answers !== null && !Array.isArray(answers)) {
            return res.status(400).json({
                message: 'answers must be an array of { questionId, selectedAnswer }.',
                code: 'VALIDATION_ERROR'
            });
        }
        const submitted = Array.isArray(answers) ? answers : [];

        const answerById = new Map();
        for (const entry of submitted) {
            if (!entry || typeof entry !== 'object') {
                return res.status(400).json({
                    message: 'Each answer must be an object with questionId and selectedAnswer.',
                    code: 'VALIDATION_ERROR'
                });
            }
            const qid = String(entry.questionId || '');
            if (!mongoose.isValidObjectId(qid) || !setIdentifiers.has(qid)) {
                // Reject arbitrary/out-of-set question ids outright.
                return res.status(400).json({
                    message: 'Submitted question does not belong to today\'s Daily PYQ set.',
                    code: 'INVALID_QUESTION'
                });
            }
            // Last entry per question wins; duplicates in the array are harmless.
            answerById.set(qid, entry.selectedAnswer);
        }

        // Load the set's questions WITHOUT the isActive filter: a question
        // deactivated after the set froze must not invalidate in-flight
        // attempts. (Docs deleted entirely grade as skipped, below.)
        const docs = await QuestionBank.find({ _id: { $in: set.questionIds } });
        const docById = new Map(docs.map((q) => [q._id.toString(), q]));

        // ── Grade in frozen set order ───────────────────────────────────
        const gradedAnswers = [];
        let correctCount = 0;
        let incorrectCount = 0;
        let skippedCount = 0;

        for (const qid of set.questionIds) {
            const idStr = qid.toString();
            const question = docById.get(idStr);
            const selectedAnswer = answerById.get(idStr);

            if (!question) {
                // Question vanished from the bank after the set froze:
                // nobody can answer it — count it as skipped, no penalty.
                skippedCount += 1;
                gradedAnswers.push({
                    question: qid,
                    questionText: '(Question no longer available)',
                    selectedAnswer: null,
                    correctAnswer: null,
                    answered: false,
                    isCorrect: false,
                    explanation: ''
                });
                continue;
            }

            const { answered, isCorrect } = gradeQuestion(question, selectedAnswer);
            if (!answered) skippedCount += 1;
            else if (isCorrect) correctCount += 1;
            else incorrectCount += 1;

            gradedAnswers.push({
                question: question._id,
                questionType: question.questionType,
                questionText: question.question,
                questionImage: question.questionImage || undefined,
                options: question.options,
                optionImages: question.optionImages || undefined,
                assertion: question.assertion || undefined,
                reason: question.reason || undefined,
                selectedAnswer: selectedAnswer === undefined ? null : selectedAnswer,
                correctAnswer: question.correctAnswer,
                answered,
                isCorrect,
                explanation: question.explanation || '',
                explanationImage: question.explanationImage || undefined
            });
        }

        const totalQuestions = set.questionIds.length;
        const timeTaken =
            Number.isFinite(Number(timeTakenSeconds)) && Number(timeTakenSeconds) >= 0
                ? Math.min(Math.floor(Number(timeTakenSeconds)), MAX_TIME_TAKEN_SECONDS)
                : 0;

        let attempt;
        try {
            attempt = await DailyPyqAttempt.create({
                student: req.user._id,
                date: todayKey,
                questionIds: set.questionIds,
                answers: gradedAnswers,
                correctCount,
                incorrectCount,
                skippedCount,
                totalQuestions,
                score: correctCount * MARKS_CORRECT - incorrectCount * MARKS_INCORRECT,
                maxScore: totalQuestions * MARKS_CORRECT,
                timeTakenSeconds: timeTaken,
                submittedAt: new Date()
            });
        } catch (error) {
            // Lost a race against a concurrent submission: the unique
            // {student, date} index is the real authority. Return the winner.
            if (error.code === 11000 || error.message?.includes('E11000')) {
                const winner = await DailyPyqAttempt.findOne({
                    student: req.user._id,
                    date: todayKey
                });
                if (winner) {
                    const streak = await streakFor(req.user._id, todayKey);
                    return res.json({ attempt: winner.toObject(), duplicate: true, streak });
                }
            }
            throw error;
        }

        const streak = await streakFor(req.user._id, todayKey);
        return res.status(201).json({ attempt: attempt.toObject(), duplicate: false, streak });
    } catch (error) {
        console.error('[daily-pyq] POST /submit failed:', error);
        return res.status(500).json({
            message: 'Could not submit Daily PYQ. Please try again.',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ── GET /history — this student's past attempts (paginated) ───────────────

router.get('/history', auth, async (req, res) => {
    try {
        const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 1000);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);

        const filter = { student: req.user._id };
        const [total, attempts] = await Promise.all([
            DailyPyqAttempt.countDocuments(filter),
            DailyPyqAttempt.find(filter)
                .sort({ date: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select('date score maxScore correctCount incorrectCount skippedCount totalQuestions timeTakenSeconds submittedAt')
                .lean()
        ]);

        return res.json({
            attempts,
            total,
            page,
            pages: Math.max(Math.ceil(total / limit), 1)
        });
    } catch (error) {
        console.error('[daily-pyq] GET /history failed:', error);
        return res.status(500).json({
            message: 'Could not load Daily PYQ history.',
            code: 'INTERNAL_ERROR'
        });
    }
});

// ── GET /attempts/:attemptId — one attempt's full graded detail ───────────

router.get('/attempts/:attemptId', auth, async (req, res) => {
    try {
        const { attemptId } = req.params;
        if (!mongoose.isValidObjectId(attemptId)) {
            return res.status(400).json({ message: 'Invalid attempt id.', code: 'VALIDATION_ERROR' });
        }

        const attempt = await DailyPyqAttempt.findById(attemptId).lean();
        // Ownership: another student's attempt must not even be revealed to
        // exist — 404 for foreign ids, exactly like the quiz results route.
        if (!attempt || attempt.student.toString() !== req.user._id.toString()) {
            return res.status(404).json({ message: 'Attempt not found.', code: 'NOT_FOUND' });
        }

        return res.json({ attempt });
    } catch (error) {
        console.error('[daily-pyq] GET /attempts/:id failed:', error);
        return res.status(500).json({
            message: 'Could not load Daily PYQ attempt.',
            code: 'INTERNAL_ERROR'
        });
    }
});

module.exports = router;
