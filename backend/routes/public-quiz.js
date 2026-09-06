const express = require('express');
const crypto = require('crypto');
const Quiz = require('../models/Quiz');
const QuestionBank = require('../models/QuestionBank');
const GuestAttempt = require('../models/GuestAttempt');
const Guest = require('../models/Guest');
const { gradeQuestion } = require('../utils/grading');
const { buildMetadataSnapshot } = require('../utils/questionSnapshot');
const { guestAuth, optionalGuestAuth } = require('../middleware/guestAuth');
const { maskPhone } = require('../utils/phone');
const { getPublicWebAppUrl } = require('../utils/publicWebUrl');
const { findActivePublicQuiz, sendPublicQuizError } = require('../utils/publicQuizAccess');
const { buildAttemptResults } = require('../utils/attemptResults');
const {
    isSectionLockEnforced,
    resolveQuizSections,
    buildSectionSnapshot,
    buildQuestionIdToSectionMap,
    computeSectionSubmit,
    closeSectionStates,
    syncExpiredSections,
} = require('../utils/sectionLocking');

const router = express.Router();

// ============ SECTION LOCKING HELPERS (guest) ============

// Only positional/response fields are ever trusted from a client answer —
// correctness and metadata are always server-derived at submit time.
const sanitizeGuestAnswer = (a) => ({
    questionIndex: a.questionIndex,
    questionId: a.questionId,
    selectedAnswer: a.selectedAnswer,
    markedForReview: !!a.markedForReview,
    timeSpent: a.timeSpent || 0
});

// Merges client answers onto the stored rows, keeping only entries whose
// section is still open. Locked sections keep their persisted values — a
// client (offline queue, tampered state, old binary) can never overwrite a
// submitted section through save-progress or whole-quiz submit.
const mergeOpenSectionGuestAnswers = (attempt, clientAnswers) => {
    const qidToSection = buildQuestionIdToSectionMap(attempt.sectionDefinitions);
    const storedByIndex = new Map((attempt.answers || []).map(a => [a.questionIndex, a]));
    const merged = new Map((attempt.answers || []).map(a => [a.questionIndex, sanitizeGuestAnswer(a)]));

    (Array.isArray(clientAnswers) ? clientAnswers : []).forEach(a => {
        if (!a || typeof a.questionIndex !== 'number') return;
        const stored = storedByIndex.get(a.questionIndex);
        const qid = a.questionId || stored?.questionId;
        if (!qid) return;
        const sectionIdx = qidToSection.get(String(qid));
        if (sectionIdx === undefined) return;
        const state = (attempt.sectionStates || []).find(s => Number(s.index) === Number(sectionIdx));
        if (!state || state.status !== 'in_progress') return; // locked/expired section — drop
        merged.set(a.questionIndex, sanitizeGuestAnswer(a));
    });

    return [...merged.values()].sort((a, b) => a.questionIndex - b.questionIndex);
};

// Final flush for a section submission: merges ONLY the closing section's
// client answers (the section is still open when the request arrives) so the
// last keystrokes aren't lost to the fire-and-forget save channel.
const mergeClosingSectionGuestAnswers = (attempt, clientAnswers, closingIndex) => {
    const qidToSection = buildQuestionIdToSectionMap(attempt.sectionDefinitions);
    const storedByIndex = new Map((attempt.answers || []).map(a => [a.questionIndex, a]));
    const merged = new Map((attempt.answers || []).map(a => [a.questionIndex, sanitizeGuestAnswer(a)]));

    (Array.isArray(clientAnswers) ? clientAnswers : []).forEach(a => {
        if (!a || typeof a.questionIndex !== 'number') return;
        const stored = storedByIndex.get(a.questionIndex);
        const qid = a.questionId || stored?.questionId;
        if (!qid) return;
        const sectionIdx = qidToSection.get(String(qid));
        if (sectionIdx === undefined || Number(sectionIdx) !== Number(closingIndex)) return;
        merged.set(a.questionIndex, sanitizeGuestAnswer(a));
    });

    return [...merged.values()].sort((a, b) => a.questionIndex - b.questionIndex);
};

// Grades the attempt's STORED answers and atomically finalizes it (CAS on
// status:'in_progress' — hardening over the previous plain save). Guest
// semantics preserved: no notifications and no results are returned.
//
// Grading is aligned with finalizeQuizAttempt in routes/quizzes.js: the
// quiz-level positiveMarks/negativeMarks scheme applies (previously guests
// earned question.marks||1 per correct answer with no negative marking,
// which made guest percentages incomparable with their totalMarks — an
// all-correct guest capped at 25% on a default 4/−1 quiz), and
// sectionPerformance (subject-name grouped) is computed and stored like
// registered attempts.
const gradeAndFinalizeGuestAttempt = async (attempt, { isAutoSubmit = false, sectionStates = null } = {}) => {
    const quiz = await Quiz.findById(attempt.quiz).populate({
        path: 'questions',
        select: 'correctAnswer marks questionType topicName subtopicName system tags difficulty subject',
        populate: { path: 'subject', select: 'name' }
    });
    if (!quiz) return attempt;

    const positiveMarks = quiz.positiveMarks !== undefined ? quiz.positiveMarks : 4;
    const negativeMarks = quiz.negativeMarks !== undefined ? Math.abs(quiz.negativeMarks) : 1;

    let score = 0;
    let marksObtained = 0;
    const sectionPerformance = {};

    const gradedAnswers = quiz.questions.map((question, index) => {
        const stored = (attempt.answers || []).find(a => a && a.questionIndex === index);
        const selectedAnswer = stored ? stored.selectedAnswer : -1;
        const { answered, isCorrect } = gradeQuestion(question, selectedAnswer);

        const section = question?.subject?.name || question?.topicName || 'General';
        if (!sectionPerformance[section]) {
            sectionPerformance[section] = { sectionName: section, correct: 0, incorrect: 0, skipped: 0, timeSpent: 0 };
        }

        let finalIsCorrect = false;
        if (!answered) {
            sectionPerformance[section].skipped++;
        } else if (isCorrect) {
            score++;
            marksObtained += positiveMarks;
            sectionPerformance[section].correct++;
            finalIsCorrect = true;
        } else {
            marksObtained -= negativeMarks;
            sectionPerformance[section].incorrect++;
        }
        if (stored && stored.timeSpent) {
            sectionPerformance[section].timeSpent += stored.timeSpent;
        }

        return {
            questionIndex: index,
            questionId: question._id,
            selectedAnswer,
            isCorrect: finalIsCorrect,
            markedForReview: !!(stored && stored.markedForReview),
            timeSpent: (stored && stored.timeSpent) || 0,
            metadataSnapshot: buildMetadataSnapshot(question)
        };
    });

    marksObtained = Math.round((marksObtained + Number.EPSILON) * 100) / 100;

    const sectionPerformanceArray = Object.values(sectionPerformance).map(section => {
        const attemptedInSection = section.correct + section.incorrect;
        return {
            ...section,
            accuracy: attemptedInSection > 0 ? Math.round((section.correct / attemptedInSection) * 100) : 0,
        };
    });

    const finalFields = {
        answers: gradedAnswers,
        score,
        marksObtained,
        sectionPerformance: sectionPerformanceArray,
        status: isAutoSubmit ? 'auto_submitted' : 'completed',
        endTime: new Date()
    };
    if (sectionStates !== null) {
        finalFields.sectionStates = sectionStates;
    }

    const updated = await GuestAttempt.findOneAndUpdate(
        { _id: attempt._id, guestId: attempt.guestId, status: 'in_progress' },
        { $set: finalFields },
        { new: true }
    );
    if (updated) return updated;
    const existing = await GuestAttempt.findOne({ _id: attempt._id, guestId: attempt.guestId });
    return existing || attempt;
};

// Ownership-aware attempt lookup. With a verified guest token the attempt
// must belong to the token's lead — either created under it, or a legacy
// device-keyed attempt that has no lead yet (token expiry mid-quiz must not
// strand an attempt created on the same device). Without a token (legacy
// mobile flow) the device guestId alone owns the attempt, exactly as before.
const findOwnedGuestAttempt = (attemptId, quizId, guestId, guest) => {
    const quizClause = quizId ? { quiz: quizId } : {};
    if (guest) {
        return GuestAttempt.findOne({
            _id: attemptId,
            ...quizClause,
            $or: [{ guest: guest._id }, { guestId, guest: null }],
        });
    }
    return GuestAttempt.findOne({ _id: attemptId, ...quizClause, guestId });
};

// ============ PUBLIC ROUTES (No Authentication Required) ============

/**
 * GET /api/public/share/:shareToken
 * Backward-compatible entry point for links already in the wild (older
 * share links and any bookmarked backend URLs). Always 302-redirects to the
 * web quiz page — there is NO app-redirect interstitial anymore, in any
 * environment: public quiz links must open in a browser, period. Links whose
 * quiz is missing or revoked redirect with ?invalid=1 so the web page can
 * render a clear error state; the page re-validates via the API, which stays
 * the authority for not-started/expired windows.
 */
router.get('/share/:shareToken', async (req, res) => {
    try {
        const { shareToken } = req.params;

        const webAppUrl = getPublicWebAppUrl();
        const quiz = await Quiz.findOne({ shareToken, isPublic: true, isActive: true }).select('_id');
        const target = quiz
            ? `${webAppUrl}/public-quiz/${shareToken}`
            : `${webAppUrl}/public-quiz/${shareToken}?invalid=1`;
        return res.redirect(302, target);
    } catch (error) {
        console.error('Error serving share redirect:', error);
        // Even on an unexpected error, never fall back to an app redirect.
        return res.redirect(302, `${getPublicWebAppUrl()}/public-quiz/${req.params.shareToken}?invalid=1`);
    }
});

/**
 * GET /api/public/quiz/:shareToken
 * Get quiz details by share token for guest users
 */
router.get('/quiz/:shareToken', async (req, res) => {
    try {
        const { shareToken } = req.params;

        // Shared public-access check: link-level expiry only (the quiz's
        // internal student window does not apply to public guests).
        const access = await findActivePublicQuiz(shareToken, {
            select: 'title subject duration instructions totalMarks questions publicExpiryDate lockSectionsAfterSubmission sections',
        })
            .then(async (result) => {
                if (result.error || !result.quiz) return result;
                await Quiz.populate(result.quiz, { path: 'subject', select: 'name' });
                return result;
            });
        if (access.error) {
            return sendPublicQuizError(res, access.error);
        }
        const quiz = access.quiz;

        res.json({
            success: true,
            quiz: {
                _id: quiz._id,
                title: quiz.title,
                subject: quiz.subject,
                duration: quiz.duration,
                instructions: quiz.instructions,
                totalMarks: quiz.totalMarks,
                questionCount: quiz.questions.length,
                lockSectionsAfterSubmission: quiz.lockSectionsAfterSubmission !== false,
                // Structure only (no question content) — the guest landing
                // page uses this to show the sequential-sections notice.
                sections: resolveQuizSections(quiz).map(s => ({
                    name: s.name,
                    duration: s.duration,
                    questionCount: s.questionIds.length
                }))
            }
        });
    } catch (error) {
        console.error('Error fetching public quiz:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/public/quiz/:shareToken/start
 * Start a guest quiz attempt. With a verified guest token (web OTP flow)
 * the attempt is stamped with the lead ref + name/phone snapshot and can be
 * resumed from any device tied to that lead; without one (legacy mobile
 * flow) the device guestId behaves exactly as before.
 */
router.post('/quiz/:shareToken/start', optionalGuestAuth, async (req, res) => {
    try {
        const { shareToken } = req.params;
        const { guestId, deviceInfo } = req.body;

        if (!guestId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID is required'
            });
        }

        const access = await findActivePublicQuiz(shareToken, {
            populate: {
                path: 'questions',
                select: 'question options optionImages questionImage marks subject questionType assertion reason columnA columnB',
                populate: {
                    path: 'subject',
                    select: 'name'
                }
            }
        });
        if (access.error) {
            return sendPublicQuizError(res, access.error);
        }
        const quiz = access.quiz;

        // Check for existing in-progress attempt — same device first, then
        // (OTP flow) any device under the verified lead.
        let attempt = await GuestAttempt.findOne({
            quiz: quiz._id,
            guestId,
            status: 'in_progress'
        });

        if (!attempt && req.guest) {
            attempt = await GuestAttempt.findOne({
                quiz: quiz._id,
                guest: req.guest._id,
                status: 'in_progress'
            });
        }

        if (attempt) {
            // Resume existing attempt. For section-locked attempts, lazily
            // apply any sections whose server-side deadlines expired while
            // the guest was away before returning state. The sync keys on
            // the ATTEMPT's own guestId — a cross-device resume under the
            // verified lead may carry a different device UUID than the one
            // that created the attempt (same contract as the submit routes;
            // keying on the caller's guestId would make the sync find
            // nothing and falsely report the attempt as ended).
            if (isSectionLockEnforced(attempt)) {
                const synced = await syncExpiredSections(GuestAttempt, {
                    _id: attempt._id,
                    guestId: attempt.guestId,
                    quiz: quiz._id,
                }, { finalize: gradeAndFinalizeGuestAttempt });

                if (!synced.attempt || synced.attempt.status !== 'in_progress') {
                    return res.json({
                        success: true,
                        message: 'This quiz attempt has ended and has been submitted',
                        attemptFinalized: true,
                        status: synced.attempt?.status || 'auto_submitted'
                    });
                }

                return res.json({
                    success: true,
                    message: 'Resuming existing attempt',
                    attempt: {
                        _id: synced.attempt._id,
                        startTime: synced.attempt.startTime,
                        answers: synced.attempt.answers,
                        sectionLockEnabled: true,
                        sectionDefinitions: synced.attempt.sectionDefinitions,
                        sectionStates: synced.attempt.sectionStates,
                        serverNow: new Date().toISOString()
                    },
                    quiz: {
                        _id: quiz._id,
                        title: quiz.title,
                        duration: quiz.duration,
                        questions: quiz.questions.map(q => ({
                            _id: q._id,
                            questionText: q.question,
                            subjectName: q.subject?.name || 'Uncategorized',
                            questionType: q.questionType,
                            options: q.options,
                            questionImage: q.questionImage,
                            optionImages: q.optionImages,
                            assertion: q.assertion,
                            reason: q.reason,
                            columnA: q.columnA,
                            columnB: q.columnB,
                            marks: q.marks || 1
                        })),
                        totalMarks: quiz.totalMarks
                    }
                });
            }

            // Resume existing attempt (flat / non-locked)
            return res.json({
                success: true,
                message: 'Resuming existing attempt',
                attempt: {
                    _id: attempt._id,
                    startTime: attempt.startTime,
                    answers: attempt.answers,
                    // Client-side timers are computed against the server
                    // clock so device clock skew cannot extend/shrink them.
                    serverNow: new Date().toISOString()
                },
                quiz: {
                    _id: quiz._id,
                    title: quiz.title,
                    duration: quiz.duration,
                    questions: quiz.questions.map(q => ({
                        _id: q._id,
                        questionText: q.question,
                        subjectName: q.subject?.name || 'Uncategorized',
                        questionType: q.questionType,
                        options: q.options,
                        questionImage: q.questionImage,
                        optionImages: q.optionImages,
                        assertion: q.assertion,
                        reason: q.reason,
                        columnA: q.columnA,
                        columnB: q.columnB,
                        marks: q.marks || 1
                    })),
                    totalMarks: quiz.totalMarks
                }
            });
        }

        // Create new attempt. Section-locking snapshot is frozen here (same
        // helper + shapes as authenticated attempts). OTP-flow attempts are
        // stamped with the lead ref + immutable name/email/phone snapshot.
        const sectionSnapshot = buildSectionSnapshot(quiz, new Date());
        attempt = new GuestAttempt({
            quiz: quiz._id,
            guestId,
            deviceInfo,
            guest: req.guest ? req.guest._id : null,
            guestName: req.guest ? req.guest.name : null,
            guestEmail: req.guest ? req.guest.email : null,
            guestPhone: req.guest ? req.guest.phone : null,
            totalQuestions: quiz.questions.length,
            totalMarks: quiz.totalMarks,
            ...(sectionSnapshot.sectionLockEnabled ? sectionSnapshot : {}),
            answers: quiz.questions.map((q, index) => ({
                questionIndex: index,
                questionId: q._id,
                selectedAnswer: -1,
                isCorrect: false,
                markedForReview: false,
                timeSpent: 0
            }))
        });

        await attempt.save();

        // Concurrent-start reconciliation. Two parallel /start calls (double
        // tap, multiple tabs, React StrictMode's dev double-mount) can both
        // pass the findOne above before either save commits, leaving the
        // guest with two live attempts — resume would then bounce between
        // them, resetting visible progress. Earliest-wins: whichever request
        // did NOT create the oldest in-progress attempt deletes its own and
        // answers with the oldest instead. Both racers converge on the same
        // survivor deterministically.
        const liveAttempts = await GuestAttempt.find({
            quiz: quiz._id,
            status: 'in_progress',
            $or: [{ guestId }, ...(req.guest ? [{ guest: req.guest._id }] : [])],
        }).sort({ createdAt: 1, _id: 1 });
        if (liveAttempts.length > 1 && String(liveAttempts[0]._id) !== String(attempt._id)) {
            await GuestAttempt.deleteOne({ _id: attempt._id });
            attempt = liveAttempts[0];
        }

        if (req.guest) {
            await Guest.updateOne(
                { _id: req.guest._id },
                { $set: { lastActiveAt: new Date() }, $addToSet: { quizzesTaken: quiz._id } }
            );
        }

        res.status(201).json({
            success: true,
            message: 'Quiz started',
            ...(req.guest ? {
                lead: {
                    _id: req.guest._id,
                    name: req.guest.name,
                    email: req.guest.email,
                    phoneMasked: maskPhone(req.guest.phone)
                }
            } : {}),
            attempt: {
                _id: attempt._id,
                startTime: attempt.startTime,
                answers: attempt.answers,
                // Server clock reference for ALL quiz shapes (flat timers
                // need it too — see the resume path above).
                serverNow: new Date().toISOString(),
                ...(attempt.sectionLockEnabled ? {
                    sectionLockEnabled: true,
                    sectionDefinitions: attempt.sectionDefinitions,
                    sectionStates: attempt.sectionStates
                } : {})
            },
            quiz: {
                _id: quiz._id,
                title: quiz.title,
                duration: quiz.duration,
                questions: quiz.questions.map(q => ({
                    _id: q._id,
                    questionText: q.question,
                    subjectName: q.subject?.name || 'Uncategorized',
                    questionType: q.questionType,
                    options: q.options,
                    questionImage: q.questionImage,
                    optionImages: q.optionImages,
                    assertion: q.assertion,
                    reason: q.reason,
                    columnA: q.columnA,
                    columnB: q.columnB,
                    marks: q.marks || 1
                })),
                totalMarks: quiz.totalMarks
            }
        });
    } catch (error) {
        console.error('Error starting guest quiz:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/public/quiz/:shareToken/submit
 * Submit a guest quiz attempt
 */
router.post('/quiz/:shareToken/submit', optionalGuestAuth, async (req, res) => {
    try {
        const { shareToken } = req.params;
        const { guestId, attemptId, answers, tabSwitchCount, tabSwitchLog } = req.body;

        if (!guestId || !attemptId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID and attempt ID are required'
            });
        }

        const access = await findActivePublicQuiz(shareToken, {
            populate: {
                path: 'questions',
                select: 'correctAnswer marks questionType topicName subtopicName system tags difficulty subject',
                populate: { path: 'subject', select: 'name' }
            }
        });
        if (access.error) {
            return sendPublicQuizError(res, access.error);
        }
        const quiz = access.quiz;

        const attempt = await findOwnedGuestAttempt(attemptId, quiz._id, guestId, req.guest);

        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found'
            });
        }

        if (attempt.status !== 'in_progress') {
            // Section-locked attempts finalize idempotently (races with the
            // lazy expiry cascade or a replayed request converge to 200);
            // non-locking attempts keep the historical 400.
            if (isSectionLockEnforced(attempt)) {
                return res.json({
                    success: true,
                    message: 'This attempt has already been submitted',
                    attemptId: attempt._id,
                    submitted: true,
                    isAlreadySubmitted: true
                });
            }
            return res.status(400).json({
                success: false,
                message: 'This attempt has already been submitted'
            });
        }

        // Section-locking defensive path: never offered by the UI, but old
        // clients / crafted requests may hit it. Lazily apply expiries, then
        // only answers for still-open sections are accepted — submitted
        // sections keep their persisted values. Post-ownership queries key
        // on the ATTEMPT's own guestId (cross-device resume via the lead may
        // send a different device UUID than the one that created it).
        if (isSectionLockEnforced(attempt)) {
            const synced = await syncExpiredSections(GuestAttempt, {
                _id: attempt._id,
                guestId: attempt.guestId,
                quiz: quiz._id,
            }, { finalize: gradeAndFinalizeGuestAttempt });

            const current = synced.attempt || attempt;
            if (current.status !== 'in_progress') {
                return res.json({
                    success: true,
                    message: 'This attempt has already been submitted',
                    attemptId: current._id,
                    submitted: true,
                    isAlreadySubmitted: true
                });
            }

            current.answers = mergeOpenSectionGuestAnswers(current, answers);
            current.tabSwitchCount = tabSwitchCount || current.tabSwitchCount;
            current.tabSwitchLog = tabSwitchLog || current.tabSwitchLog;
            const closedStates = closeSectionStates(current.sectionStates, { status: 'submitted' });
            await gradeAndFinalizeGuestAttempt(current, { sectionStates: closedStates });

            return res.json({
                success: true,
                message: 'Quiz submitted successfully',
                attemptId: current._id,
                // We don't return score/results to guests
                submitted: true
            });
        }

        // Calculate score. Server-side grading is the only source of truth —
        // client-submitted isCorrect/metadataSnapshot values are never
        // trusted. Marking scheme matches finalizeQuizAttempt (registered
        // users): +positiveMarks correct, −|negativeMarks| incorrect, and
        // sectionPerformance (subject grouped) is computed and stored.
        const positiveMarks = quiz.positiveMarks !== undefined ? quiz.positiveMarks : 4;
        const negativeMarks = quiz.negativeMarks !== undefined ? Math.abs(quiz.negativeMarks) : 1;

        let score = 0;
        let marksObtained = 0;
        const sectionPerformance = {};

        const clientAnswers = Array.isArray(answers) ? answers : [];

        const gradedAnswers = quiz.questions.map((question, index) => {
            const clientAnswer = clientAnswers.find(a => a && a.questionIndex === index) || clientAnswers[index];
            const selectedAnswer = clientAnswer ? clientAnswer.selectedAnswer : -1;
            const { answered, isCorrect } = gradeQuestion(question, selectedAnswer);

            const section = question?.subject?.name || question?.topicName || 'General';
            if (!sectionPerformance[section]) {
                sectionPerformance[section] = { sectionName: section, correct: 0, incorrect: 0, skipped: 0, timeSpent: 0 };
            }

            let finalIsCorrect = false;
            if (!answered) {
                sectionPerformance[section].skipped++;
            } else if (isCorrect) {
                score++;
                marksObtained += positiveMarks;
                sectionPerformance[section].correct++;
                finalIsCorrect = true;
            } else {
                marksObtained -= negativeMarks;
                sectionPerformance[section].incorrect++;
            }
            if (clientAnswer && clientAnswer.timeSpent) {
                sectionPerformance[section].timeSpent += clientAnswer.timeSpent;
            }

            return {
                questionIndex: index,
                questionId: question._id,
                selectedAnswer,
                isCorrect: finalIsCorrect,
                markedForReview: !!(clientAnswer && clientAnswer.markedForReview),
                timeSpent: (clientAnswer && clientAnswer.timeSpent) || 0,
                metadataSnapshot: buildMetadataSnapshot(question)
            };
        });

        marksObtained = Math.round((marksObtained + Number.EPSILON) * 100) / 100;

        const sectionPerformanceArray = Object.values(sectionPerformance).map(section => {
            const attemptedInSection = section.correct + section.incorrect;
            return {
                ...section,
                accuracy: attemptedInSection > 0 ? Math.round((section.correct / attemptedInSection) * 100) : 0,
            };
        });

        // Update attempt
        attempt.answers = gradedAnswers;
        attempt.score = score;
        attempt.marksObtained = marksObtained;
        attempt.sectionPerformance = sectionPerformanceArray;
        attempt.status = 'completed';
        attempt.endTime = new Date();
        attempt.tabSwitchCount = tabSwitchCount || 0;
        attempt.tabSwitchLog = tabSwitchLog || [];

        await attempt.save();

        if (req.guest) {
            await Guest.updateOne(
                { _id: req.guest._id },
                { $set: { lastActiveAt: new Date() } }
            );
        }

        // Return success but NOT the actual results (guest must sign in to see results)
        res.json({
            success: true,
            message: 'Quiz submitted successfully',
            attemptId: attempt._id,
            // We don't return score/results to guests
            submitted: true
        });
    } catch (error) {
        console.error('Error submitting guest quiz:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/public/quiz/:shareToken/sections/:sectionIndex/submit
 * Submit a single section of a guest attempt (section locking).
 * Server-authoritative mirror of the authenticated section submit: lazily
 * applies expiries, validates the section is the active one, closes it with
 * an atomic CAS, merges the section's final answers, opens the next section
 * or finalizes the attempt. Idempotent for double clicks / replays / races.
 */
router.post('/quiz/:shareToken/sections/:sectionIndex/submit', optionalGuestAuth, async (req, res) => {
    try {
        const { shareToken } = req.params;
        const sectionIndex = Number(req.params.sectionIndex);
        const { guestId, attemptId, isAutoSubmit, answers } = req.body;

        if (!guestId || !attemptId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID and attempt ID are required'
            });
        }

        const quiz = await Quiz.findOne({ shareToken, isPublic: true });
        if (!quiz) {
            return res.status(404).json({ success: false, message: 'Quiz not found' });
        }

        const attempt = await findOwnedGuestAttempt(attemptId, quiz._id, guestId, req.guest);

        if (!attempt) {
            return res.status(404).json({ success: false, message: 'Attempt not found' });
        }

        if (attempt.status !== 'in_progress') {
            return res.json({
                success: true,
                message: 'Quiz already submitted',
                isAlreadySubmitted: true,
                attemptFinalized: true,
                status: attempt.status
            });
        }

        if (!isSectionLockEnforced(attempt)) {
            return res.status(400).json({
                success: false,
                message: 'Section locking is not enabled for this quiz attempt',
                errorCode: 'SECTION_LOCKING_DISABLED'
            });
        }

        // Lazily apply sections that expired while the guest was away —
        // this may itself finalize the attempt. Keyed on the attempt's own
        // guestId (cross-device resume may carry a different device UUID).
        const synced = await syncExpiredSections(GuestAttempt, {
            _id: attempt._id,
            guestId: attempt.guestId,
            quiz: quiz._id,
        }, { finalize: gradeAndFinalizeGuestAttempt });

        const current = synced.attempt || attempt;
        if (current.status !== 'in_progress') {
            return res.json({
                success: true,
                message: 'Quiz already submitted',
                isAlreadySubmitted: true,
                attemptFinalized: true,
                status: current.status
            });
        }

        const definitions = current.sectionDefinitions;
        const states = current.sectionStates;

        if (!Number.isInteger(sectionIndex) || sectionIndex < 0 || sectionIndex >= definitions.length) {
            return res.status(400).json({
                success: false,
                message: 'Invalid section index for this quiz attempt',
                errorCode: 'INVALID_SECTION_INDEX'
            });
        }

        const activeState = states.find(s => s.status === 'in_progress');
        const targetState = states.find(s => Number(s.index) === sectionIndex);

        if (targetState && targetState.status !== 'in_progress') {
            // Idempotent: already closed (double click / replay / timer won).
            return res.json({
                success: true,
                message: 'Section already submitted',
                isAlreadySubmitted: true,
                sectionIndex,
                nextActiveIndex: activeState ? Number(activeState.index) : null,
                sectionStates: states,
                serverNow: new Date().toISOString()
            });
        }

        if (!activeState || Number(activeState.index) !== sectionIndex) {
            if (activeState && sectionIndex < Number(activeState.index)) {
                return res.status(403).json({
                    success: false,
                    message: 'This section has been submitted and is locked',
                    errorCode: 'SECTION_LOCKED'
                });
            }
            return res.status(400).json({
                success: false,
                message: 'This section is not active yet. Complete the current section first',
                errorCode: 'SECTION_NOT_ACTIVE'
            });
        }

        const transition = computeSectionSubmit(definitions, states, sectionIndex, isAutoSubmit === true, new Date());
        if (transition.error) {
            return res.json({
                success: true,
                message: 'Section already submitted',
                isAlreadySubmitted: true,
                sectionIndex,
                sectionStates: states
            });
        }

        // Atomic close + final answer flush for the closing section. Guard on
        // the element still being open with the startedAt we read.
        const mergedAnswers = mergeClosingSectionGuestAnswers(current, answers, sectionIndex);
        const updated = await GuestAttempt.findOneAndUpdate(
            {
                _id: current._id,
                guestId: current.guestId,
                status: 'in_progress',
                [`sectionStates.${sectionIndex}.status`]: 'in_progress',
                ...(targetState?.startedAt ? { [`sectionStates.${sectionIndex}.startedAt`]: targetState.startedAt } : {}),
            },
            {
                $set: {
                    sectionStates: transition.states,
                    answers: mergedAnswers
                }
            },
            { new: true }
        );

        if (!updated) {
            const reread = await GuestAttempt.findOne({ _id: current._id, guestId: current.guestId });
            if (!reread) {
                return res.status(404).json({ success: false, message: 'Attempt not found' });
            }
            if (reread.status !== 'in_progress') {
                return res.json({
                    success: true,
                    message: 'Quiz already submitted',
                    isAlreadySubmitted: true,
                    attemptFinalized: true,
                    status: reread.status
                });
            }
            const reActive = reread.sectionStates.find(s => s.status === 'in_progress');
            return res.json({
                success: true,
                message: 'Section already submitted',
                isAlreadySubmitted: true,
                sectionIndex,
                nextActiveIndex: reActive ? Number(reActive.index) : null,
                sectionStates: reread.sectionStates,
                serverNow: new Date().toISOString()
            });
        }

        if (transition.finalized) {
            // Last section closed — grade + finalize; guests never receive results.
            await gradeAndFinalizeGuestAttempt(updated, { isAutoSubmit: isAutoSubmit === true });
            return res.json({
                success: true,
                message: 'Quiz submitted successfully',
                attemptId: updated._id,
                submitted: true,
                attemptFinalized: true
            });
        }

        res.json({
            success: true,
            message: 'Section submitted',
            submittedSectionIndex: sectionIndex,
            sectionStatus: isAutoSubmit === true ? 'auto_submitted' : 'submitted',
            nextSection: transition.nextSection,
            sectionStates: updated.sectionStates,
            serverNow: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error submitting guest section:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/public/quiz/:shareToken/save-progress
 * Save quiz progress for guest (auto-save)
 */
router.post('/quiz/:shareToken/save-progress', optionalGuestAuth, async (req, res) => {
    try {
        const { shareToken } = req.params;
        const { guestId, attemptId, answers, tabSwitchCount, tabSwitchLog } = req.body;

        if (!guestId || !attemptId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID and attempt ID are required'
            });
        }

        // Historical behavior: save-progress never filtered by quiz — kept.
        const attempt = await findOwnedGuestAttempt(attemptId, null, guestId, req.guest)
            .then(doc => (doc && doc.status === 'in_progress') ? doc : null);

        if (!attempt) {
            return res.status(404).json({
                success: false,
                message: 'Attempt not found or already submitted'
            });
        }

        // Section locking: lazily apply expired sections first, then MERGE
        // (never wholesale-replace) filtered answers — locked sections keep
        // their persisted values. The channel is fire-and-forget, so a
        // filtered write silently succeeds rather than erroring.
        if (isSectionLockEnforced(attempt)) {
            const quiz = await Quiz.findById(attempt.quiz);
            if (!quiz) {
                return res.status(404).json({ success: false, message: 'Quiz not found' });
            }

            const synced = await syncExpiredSections(GuestAttempt, {
                _id: attempt._id,
                guestId: attempt.guestId,
                quiz: quiz._id,
            }, { finalize: gradeAndFinalizeGuestAttempt });

            const current = synced.attempt || attempt;
            if (current.status !== 'in_progress') {
                // Fire-and-forget friendly: the attempt ended server-side.
                return res.json({
                    success: true,
                    message: 'Progress saved',
                    attemptFinalized: true,
                    status: current.status
                });
            }

            current.answers = mergeOpenSectionGuestAnswers(current, answers);
            current.tabSwitchCount = tabSwitchCount || current.tabSwitchCount;
            current.tabSwitchLog = tabSwitchLog || current.tabSwitchLog;

            await GuestAttempt.updateOne(
                { _id: current._id },
                {
                    $set: {
                        answers: current.answers,
                        tabSwitchCount: current.tabSwitchCount,
                        tabSwitchLog: current.tabSwitchLog
                    }
                }
            );

            return res.json({ success: true, message: 'Progress saved' });
        }

        // Update progress. Only positional/response fields are trusted from
        // the client — correctness and metadata are always server-derived,
        // and only ever computed at submit time.
        attempt.answers = (Array.isArray(answers) ? answers : []).map(a => ({
            questionIndex: a.questionIndex,
            questionId: a.questionId,
            selectedAnswer: a.selectedAnswer,
            markedForReview: !!a.markedForReview,
            timeSpent: a.timeSpent || 0
        }));
        attempt.tabSwitchCount = tabSwitchCount || attempt.tabSwitchCount;
        attempt.tabSwitchLog = tabSwitchLog || attempt.tabSwitchLog;

        await attempt.save();

        res.json({
            success: true,
            message: 'Progress saved'
        });
    } catch (error) {
        console.error('Error saving guest progress:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/public/quiz/:shareToken/attempt/:attemptId/result
 * The guest's own result — score summary (correct/incorrect/skipped, marks,
 * percentage, accuracy, time, grouped performance). Detailed solutions are
 * included only when the quiz's live shareSolution setting allows it — the
 * same gate registered users get. Scoped to the token's lead; any mismatch
 * returns a bare 404 so attempts of other guests cannot be probed.
 */
router.get('/quiz/:shareToken/attempt/:attemptId/result', guestAuth, async (req, res) => {
    try {
        const { shareToken, attemptId } = req.params;
        const requestedGroupBy = String(req.query.groupBy || '').toLowerCase().trim();

        const attempt = await GuestAttempt.findOne({
            _id: attemptId,
            guest: req.guest._id,
            status: { $in: ['completed', 'auto_submitted'] }
        }).populate({
            path: 'quiz',
            populate: { path: 'questions', model: 'QuestionBank' }
        });

        if (!attempt || !attempt.quiz) {
            return res.status(404).json({
                success: false,
                message: 'Result not found',
                code: 'ATTEMPT_NOT_FOUND'
            });
        }

        // The attempt must belong to THIS link's quiz — no cross-link probing.
        if (attempt.quiz.shareToken && attempt.quiz.shareToken !== shareToken) {
            return res.status(404).json({
                success: false,
                message: 'Result not found',
                code: 'ATTEMPT_NOT_FOUND'
            });
        }

        const quiz = await Quiz.findById(attempt.quiz._id);
        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Result not found',
                code: 'ATTEMPT_NOT_FOUND'
            });
        }

        const result = await buildAttemptResults({
            attempt,
            quiz,
            groupBy: requestedGroupBy,
            includeStudentHistory: false,
            student: { _id: req.guest._id, name: req.guest.name }
        });

        res.json({
            success: true,
            ...result,
            guest: {
                _id: req.guest._id,
                name: req.guest.name,
                email: req.guest.email,
                phoneMasked: maskPhone(req.guest.phone)
            }
        });
    } catch (error) {
        console.error('Error fetching guest result:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
