const express = require('express');
const crypto = require('crypto');
const Quiz = require('../models/Quiz');
const QuestionBank = require('../models/QuestionBank');
const GuestAttempt = require('../models/GuestAttempt');
const { gradeQuestion } = require('../utils/grading');
const { buildMetadataSnapshot } = require('../utils/questionSnapshot');
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
const gradeAndFinalizeGuestAttempt = async (attempt, { isAutoSubmit = false, sectionStates = null } = {}) => {
    const quiz = await Quiz.findById(attempt.quiz).populate({
        path: 'questions',
        select: 'correctAnswer marks questionType topicName subtopicName system tags difficulty subject',
        populate: { path: 'subject', select: 'name' }
    });
    if (!quiz) return attempt;

    let score = 0;
    let marksObtained = 0;

    const gradedAnswers = quiz.questions.map((question, index) => {
        const stored = (attempt.answers || []).find(a => a && a.questionIndex === index);
        const selectedAnswer = stored ? stored.selectedAnswer : -1;
        const { answered, isCorrect } = gradeQuestion(question, selectedAnswer);
        const marks = question?.marks || 1;

        if (isCorrect) {
            score++;
            marksObtained += marks;
        }

        return {
            questionIndex: index,
            questionId: question._id,
            selectedAnswer,
            isCorrect: answered ? isCorrect : false,
            markedForReview: !!(stored && stored.markedForReview),
            timeSpent: (stored && stored.timeSpent) || 0,
            metadataSnapshot: buildMetadataSnapshot(question)
        };
    });

    const finalFields = {
        answers: gradedAnswers,
        score,
        marksObtained,
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

// ============ PUBLIC ROUTES (No Authentication Required) ============

/**
 * GET /api/public/share/:shareToken
 * HTML Redirect page for deep linking (clickable in WhatsApp etc.)
 */
router.get('/share/:shareToken', async (req, res) => {
    try {
        const { shareToken } = req.params;
        const deepLink = `mentorship://quiz/${shareToken}`;

        // Simple HTML to handle redirect
        const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Opening Quiz...</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f7f7f7; text-align: center; padding: 20px; }
        .card { background: white; padding: 30px; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
        h1 { font-size: 20px; margin-bottom: 10px; color: #1f2937; }
        p { color: #6b7280; margin-bottom: 24px; line-height: 1.5; }
        .btn { display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; transition: background-color 0.2s; }
        .btn:hover { background-color: #1d4ed8; }
    </style>
    <script>
        window.onload = function() {
            window.location.href = "${deepLink}";
            setTimeout(function() {
                document.getElementById('manual-link').style.display = 'block';
            }, 1000);
        }
    </script>
</head>
<body>
    <div class="card">
        <h1>Opening Eyeconic Quiz</h1>
        <p>Attempting to open the quiz in the Eyeconic app...</p>
        <a href="${deepLink}" class="btn">Open App</a>
        <p id="manual-link" style="display:none; margin-top: 16px; font-size: 14px;">If the app doesn't open, please ensure it is installed.</p>
    </div>
</body>
</html>
        `;

        res.send(html);
    } catch (error) {
        console.error('Error serving redirect:', error);
        res.status(500).send('Server error');
    }
});

/**
 * GET /api/public/quiz/:shareToken
 * Get quiz details by share token for guest users
 */
router.get('/quiz/:shareToken', async (req, res) => {
    try {
        const { shareToken } = req.params;

        const quiz = await Quiz.findOne({
            shareToken,
            isPublic: true,
            isActive: true
        })
            .populate('subject', 'name')
            .select('title subject duration instructions totalMarks questions publicExpiryDate scheduledDate expiryDate lockSectionsAfterSubmission sections');

        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found or link has expired'
            });
        }

        // Enforce time window
        const now = new Date();
        if (quiz.scheduledDate && now < quiz.scheduledDate) {
            return res.status(403).json({ success: false, message: 'This quiz has not started yet. It opens on ' + quiz.scheduledDate.toLocaleString(), scheduledDate: quiz.scheduledDate });
        }
        if (quiz.expiryDate && now > quiz.expiryDate) {
            return res.status(403).json({ success: false, message: 'This quiz has expired. It closed on ' + quiz.expiryDate.toLocaleString(), expiryDate: quiz.expiryDate });
        }

        // Check if public link has expired
        if (quiz.publicExpiryDate && new Date() > quiz.publicExpiryDate) {
            return res.status(410).json({
                success: false,
                message: 'This quiz link has expired'
            });
        }

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
 * Start a guest quiz attempt
 */
router.post('/quiz/:shareToken/start', async (req, res) => {
    try {
        const { shareToken } = req.params;
        const { guestId, deviceInfo } = req.body;

        if (!guestId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID is required'
            });
        }

        const quiz = await Quiz.findOne({
            shareToken,
            isPublic: true,
            isActive: true
        }).populate({
            path: 'questions',
            select: 'question options optionImages questionImage marks subject questionType assertion reason columnA columnB',
            populate: {
                path: 'subject',
                select: 'name'
            }
        });

        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found or link has expired'
            });
        }

        // Enforce time window
        const now = new Date();
        if (quiz.scheduledDate && now < quiz.scheduledDate) {
            return res.status(403).json({ success: false, message: 'This quiz has not started yet. It opens on ' + quiz.scheduledDate.toLocaleString(), scheduledDate: quiz.scheduledDate });
        }
        if (quiz.expiryDate && now > quiz.expiryDate) {
            return res.status(403).json({ success: false, message: 'This quiz has expired. It closed on ' + quiz.expiryDate.toLocaleString(), expiryDate: quiz.expiryDate });
        }

        // Check if public link has expired
        if (quiz.publicExpiryDate && new Date() > quiz.publicExpiryDate) {
            return res.status(410).json({
                success: false,
                message: 'This quiz link has expired'
            });
        }

        // Check for existing in-progress attempt
        let attempt = await GuestAttempt.findOne({
            quiz: quiz._id,
            guestId,
            status: 'in_progress'
        });

        if (attempt) {
            // Resume existing attempt. For section-locked attempts, lazily
            // apply any sections whose server-side deadlines expired while
            // the guest was away before returning state.
            if (isSectionLockEnforced(attempt)) {
                const synced = await syncExpiredSections(GuestAttempt, {
                    _id: attempt._id,
                    guestId,
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

            // Resume existing attempt
            return res.json({
                success: true,
                message: 'Resuming existing attempt',
                attempt: {
                    _id: attempt._id,
                    startTime: attempt.startTime,
                    answers: attempt.answers
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
        // helper + shapes as authenticated attempts).
        const sectionSnapshot = buildSectionSnapshot(quiz, new Date());
        attempt = new GuestAttempt({
            quiz: quiz._id,
            guestId,
            deviceInfo,
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

        res.status(201).json({
            success: true,
            message: 'Quiz started',
            attempt: {
                _id: attempt._id,
                startTime: attempt.startTime,
                answers: attempt.answers,
                ...(attempt.sectionLockEnabled ? {
                    sectionLockEnabled: true,
                    sectionDefinitions: attempt.sectionDefinitions,
                    sectionStates: attempt.sectionStates,
                    serverNow: new Date().toISOString()
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
router.post('/quiz/:shareToken/submit', async (req, res) => {
    try {
        const { shareToken } = req.params;
        const { guestId, attemptId, answers, tabSwitchCount, tabSwitchLog } = req.body;

        if (!guestId || !attemptId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID and attempt ID are required'
            });
        }

        const quiz = await Quiz.findOne({
            shareToken,
            isPublic: true
        }).populate({
            path: 'questions',
            select: 'correctAnswer marks questionType topicName subtopicName system tags difficulty subject',
            populate: { path: 'subject', select: 'name' }
        });

        if (!quiz) {
            return res.status(404).json({
                success: false,
                message: 'Quiz not found'
            });
        }

        const attempt = await GuestAttempt.findOne({
            _id: attemptId,
            quiz: quiz._id,
            guestId
        });

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
        // sections keep their persisted values.
        if (isSectionLockEnforced(attempt)) {
            const synced = await syncExpiredSections(GuestAttempt, {
                _id: attempt._id,
                guestId,
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
        // client-submitted isCorrect/metadataSnapshot values are never trusted.
        let score = 0;
        let marksObtained = 0;

        const clientAnswers = Array.isArray(answers) ? answers : [];

        const gradedAnswers = quiz.questions.map((question, index) => {
            const clientAnswer = clientAnswers.find(a => a && a.questionIndex === index) || clientAnswers[index];
            const selectedAnswer = clientAnswer ? clientAnswer.selectedAnswer : -1;
            const { answered, isCorrect } = gradeQuestion(question, selectedAnswer);
            const marks = question?.marks || 1;

            if (isCorrect) {
                score++;
                marksObtained += marks;
            }

            return {
                questionIndex: index,
                questionId: question._id,
                selectedAnswer,
                isCorrect: answered ? isCorrect : false,
                markedForReview: !!(clientAnswer && clientAnswer.markedForReview),
                timeSpent: (clientAnswer && clientAnswer.timeSpent) || 0,
                metadataSnapshot: buildMetadataSnapshot(question)
            };
        });

        // Update attempt
        attempt.answers = gradedAnswers;
        attempt.score = score;
        attempt.marksObtained = marksObtained;
        attempt.status = 'completed';
        attempt.endTime = new Date();
        attempt.tabSwitchCount = tabSwitchCount || 0;
        attempt.tabSwitchLog = tabSwitchLog || [];

        await attempt.save();

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
router.post('/quiz/:shareToken/sections/:sectionIndex/submit', async (req, res) => {
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

        const attempt = await GuestAttempt.findOne({
            _id: attemptId,
            quiz: quiz._id,
            guestId
        });

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
        // this may itself finalize the attempt.
        const synced = await syncExpiredSections(GuestAttempt, {
            _id: attempt._id,
            guestId,
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
                guestId,
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
            const reread = await GuestAttempt.findOne({ _id: current._id, guestId });
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
router.post('/quiz/:shareToken/save-progress', async (req, res) => {
    try {
        const { shareToken } = req.params;
        const { guestId, attemptId, answers, tabSwitchCount, tabSwitchLog } = req.body;

        if (!guestId || !attemptId) {
            return res.status(400).json({
                success: false,
                message: 'Guest ID and attempt ID are required'
            });
        }

        const attempt = await GuestAttempt.findOne({
            _id: attemptId,
            guestId,
            status: 'in_progress'
        });

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
                guestId,
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

module.exports = router;
