/**
 * Daily PYQ integration tests: frozen daily set, server-side grading,
 * duplicate/race-safe submission, ownership, history and streaks.
 */
const request = require('supertest');
const db = require('../helpers/db');
const QuestionBank = require('../../models/QuestionBank');
const DailyPyqSet = require('../../models/DailyPyqSet');
const DailyPyqAttempt = require('../../models/DailyPyqAttempt');
const Subject = require('../../models/Subject');
const dailyPyqUtil = require('../../utils/dailyPyq');
const { buildApp, createUser, createSubject } = require('../helpers/testApp');

const app = buildApp();

let student, studentToken, otherStudent, otherToken, subject;

const OPTION_COUNT = 4;

async function createQuestion({ text = 'Question', correct = 0, active = true } = {}) {
    return QuestionBank.create({
        subject: subject._id,
        topicName: 'Test Topic',
        subtopicName: 'Test Subtopic',
        system: 'Test System',
        questionType: 'mcq_single',
        difficulty: 'medium',
        question: text,
        options: Array.from({ length: OPTION_COUNT }, (_, i) => `Option ${i}`),
        correctAnswer: correct,
        explanation: `Explanation for ${text}`,
        isActive: active
    });
}

async function seedQuestions(count, prefix = 'Q') {
    const questions = [];
    for (let i = 0; i < count; i++) {
        // Distinct-prefix option so isolated suites can re-seed while older
        // same-index rows still exist (deactivated rows share dedup keys —
        // reactivating both would trip the unique index).
        questions.push(await createQuestion({ text: `${prefix}${i}`, correct: i % OPTION_COUNT }));
    }
    return questions;
}

function authHeader(token) {
    return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
    await db.connect();
    ({ user: student, token: studentToken } = await createUser({ role: 'student', name: 'Daily Student' }));
    ({ user: otherStudent, token: otherToken } = await createUser({ role: 'student', name: 'Other Student' }));
    subject = await createSubject('Daily PYQ Subject');
});

afterAll(async () => {
    await db.closeDatabase();
});

describe('Daily PYQ', () => {
    describe('GET /api/daily-pyq/today', () => {
        beforeAll(async () => {
            await seedQuestions(30);
        });

        it('requires authentication', async () => {
            const res = await request(app).get('/api/daily-pyq/today');
            expect(res.status).toBe(401);
        });

        it('returns exactly 10 questions, stable across requests and students', async () => {
            const first = await request(app).get('/api/daily-pyq/today').set(authHeader(studentToken));
            expect(first.status).toBe(200);
            expect(first.body.status).toBe('pending');
            expect(first.body.totalQuestions).toBe(10);
            expect(first.body.questions).toHaveLength(10);
            expect(first.body.streak).toEqual({ current: 0, best: 0 });

            const ids = first.body.questions.map((q) => q._id);

            // Refresh: identical set, identical order.
            const second = await request(app).get('/api/daily-pyq/today').set(authHeader(studentToken));
            expect(second.body.questions.map((q) => q._id)).toEqual(ids);

            // Another student: the same shared set.
            const third = await request(app).get('/api/daily-pyq/today').set(authHeader(otherToken));
            expect(third.body.questions.map((q) => q._id)).toEqual(ids);
        });

        it('never leaks the answer key or explanations', async () => {
            const res = await request(app).get('/api/daily-pyq/today').set(authHeader(studentToken));
            for (const q of res.body.questions) {
                expect(q).not.toHaveProperty('correctAnswer');
                expect(q).not.toHaveProperty('explanation');
                expect(q).not.toHaveProperty('explanationImage');
            }
        });

        it('persists one set per date and rotates away from recent days', async () => {
            const todayKey = dailyPyqUtil.istDateKey();
            const yesterdayKey = dailyPyqUtil.addDaysKey(todayKey, -1);

            // In production, prior days' sets already exist when today's set is
            // first requested — create yesterday first, then re-freeze today.
            await dailyPyqUtil.getOrCreateDailySet(yesterdayKey);
            const yesterdaySet = await DailyPyqSet.findOne({ date: yesterdayKey });
            expect(yesterdaySet).not.toBeNull();
            expect(yesterdaySet.questionIds).toHaveLength(10);

            await DailyPyqSet.deleteOne({ date: todayKey });
            const res = await request(app).get('/api/daily-pyq/today').set(authHeader(studentToken));
            expect(res.status).toBe(200);

            const todaySet = await DailyPyqSet.findOne({ date: todayKey });
            expect(todaySet.questionIds).toHaveLength(10);

            // 30-question pool is large enough to rotate: no overlap with yesterday.
            const overlap = todaySet.questionIds.filter((id) =>
                yesterdaySet.questionIds.some((yid) => yid.toString() === id.toString())
            );
            expect(overlap).toHaveLength(0);

            // The persisted set is authoritative: what is served IS the document.
            expect(res.body.questions.map((q) => q._id)).toEqual(
                todaySet.questionIds.map((id) => id.toString())
            );
        });

        it('regenerates the set when questions were deactivated and nobody completed yet', async () => {
            const todayKey = dailyPyqUtil.istDateKey();
            const set = await DailyPyqSet.findOne({ date: todayKey });
            await QuestionBank.updateOne(
                { _id: set.questionIds[0] },
                { $set: { isActive: false } }
            );
            const res = await request(app).get('/api/daily-pyq/today').set(authHeader(studentToken));
            expect(res.status).toBe(200);
            expect(res.body.questions).toHaveLength(10);
            expect(res.body.questions.map((q) => q._id)).not.toContain(set.questionIds[0].toString());
            // Restore for subsequent suites.
            await QuestionBank.updateOne(
                { _id: set.questionIds[0] },
                { $set: { isActive: true } }
            );
        });
    });

    describe('POST /api/daily-pyq/submit', () => {
        let questions, correctPayload;

        beforeAll(async () => {
            // Fresh date: a past date nobody touched, validated via mismatch
            // logic in one test; for the happy path we submit for *today*.
            questions = [];
            const todayKey = dailyPyqUtil.istDateKey();
            const set = await DailyPyqSet.findOne({ date: todayKey });
            const docs = await QuestionBank.find({ _id: { $in: set.questionIds } });
            const byId = new Map(docs.map((d) => [d._id.toString(), d]));
            questions = set.questionIds.map((id) => byId.get(id.toString()));
            correctPayload = (correctIds, wrongIds = []) => ({
                date: todayKey,
                timeTakenSeconds: 120,
                answers: questions.map((q) => {
                    const id = q._id.toString();
                    let selected = q.correctAnswer;
                    if (wrongIds.includes(id)) {
                        selected = (q.correctAnswer + 1) % OPTION_COUNT;
                    } else if (correctIds && !correctIds.includes(id)) {
                        selected = null;
                    }
                    return { questionId: id, selectedAnswer: selected };
                })
            });
        });

        it('requires authentication', async () => {
            const res = await request(app).post('/api/daily-pyq/submit').send({});
            expect(res.status).toBe(401);
        });

        it('rejects a date that is not today', async () => {
            const todayKey = dailyPyqUtil.istDateKey();
            const res = await request(app)
                .post('/api/daily-pyq/submit')
                .set(authHeader(studentToken))
                .send({ date: dailyPyqUtil.addDaysKey(todayKey, 1), answers: [] });
            expect(res.status).toBe(409);
            expect(res.body.code).toBe('DAILY_PYQ_DATE_MISMATCH');
            expect(res.body.currentDate).toBe(todayKey);
        });

        it('rejects answers outside the daily set', async () => {
            const outside = await createQuestion({ text: 'Outside question' });
            const todayKey = dailyPyqUtil.istDateKey();
            const res = await request(app)
                .post('/api/daily-pyq/submit')
                .set(authHeader(studentToken))
                .send({ date: todayKey, answers: [{ questionId: outside._id, selectedAnswer: 0 }] });
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('INVALID_QUESTION');
        });

        it('grades server-side with NEET PG marking and stores the attempt', async () => {
            const todayKey = dailyPyqUtil.istDateKey();
            const set = await DailyPyqSet.findOne({ date: todayKey });
            const allIds = set.questionIds.map((id) => id.toString());

            // 8 correct, 1 wrong, 1 skipped => 8*4 - 1 = 31.
            const wrongId = allIds[0];
            const skippedId = allIds[1];
            const correctIds = allIds.slice(2);

            const res = await request(app)
                .post('/api/daily-pyq/submit')
                .set(authHeader(studentToken))
                .send(correctPayload(correctIds, [wrongId]));
            expect(res.status).toBe(201);
            expect(res.body.duplicate).toBe(false);
            expect(res.body.attempt.score).toBe(8 * 4 - 1);
            expect(res.body.attempt.correctCount).toBe(8);
            expect(res.body.attempt.incorrectCount).toBe(1);
            expect(res.body.attempt.skippedCount).toBe(1);
            expect(res.body.attempt.totalQuestions).toBe(10);
            expect(res.body.attempt.maxScore).toBe(40);
            expect(res.body.attempt.timeTakenSeconds).toBe(120);
            expect(res.body.attempt.answers).toHaveLength(10);

            // Results carry the answer key + explanations (the student completed).
            const gradedSkipped = res.body.attempt.answers.find(
                (a) => a.question.toString() === skippedId
            );
            expect(gradedSkipped.answered).toBe(false);
            expect(gradedSkipped.isCorrect).toBe(false);
            expect(gradedSkipped.explanation).toContain('Explanation');

            // Only ONE attempt row exists for this student today.
            const count = await DailyPyqAttempt.countDocuments({
                student: student._id,
                date: todayKey
            });
            expect(count).toBe(1);
        });

        it('is idempotent on duplicate submission (double click / retry)', async () => {
            const todayKey = dailyPyqUtil.istDateKey();
            const original = await DailyPyqAttempt.findOne({
                student: student._id,
                date: todayKey
            });

            const res = await request(app)
                .post('/api/daily-pyq/submit')
                .set(authHeader(studentToken))
                .send(correctPayload());
            expect(res.status).toBe(200);
            expect(res.body.duplicate).toBe(true);
            expect(res.body.attempt._id).toBe(original._id.toString());

            const count = await DailyPyqAttempt.countDocuments({
                student: student._id,
                date: todayKey
            });
            expect(count).toBe(1);
        });

        it('resolves concurrent submissions to a single attempt', async () => {
            const todayKey = dailyPyqUtil.istDateKey();
            // Other student submits twice in parallel.
            const [a, b] = await Promise.all([
                request(app).post('/api/daily-pyq/submit')
                    .set(authHeader(otherToken))
                    .send(correctPayload()),
                request(app).post('/api/daily-pyq/submit')
                    .set(authHeader(otherToken))
                    .send(correctPayload())
            ]);
            const ids = new Set([a.body.attempt._id, b.body.attempt._id]);
            expect(ids.size).toBe(1);
            expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 201]);
            const count = await DailyPyqAttempt.countDocuments({
                student: otherStudent._id,
                date: todayKey
            });
            expect(count).toBe(1);
        });

        it('marks today as completed and hides questions from GET /today', async () => {
            const res = await request(app).get('/api/daily-pyq/today').set(authHeader(studentToken));
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('completed');
            expect(res.body.questions).toEqual([]);
            expect(res.body.attempt.score).toBe(8 * 4 - 1);
            expect(res.body.streak.current).toBe(1);
        });
    });

    describe('GET /api/daily-pyq/history', () => {
        it('lists only this student\'s attempts, newest first', async () => {
            const res = await request(app).get('/api/daily-pyq/history').set(authHeader(studentToken));
            expect(res.status).toBe(200);
            expect(res.body.total).toBe(1);
            expect(res.body.attempts).toHaveLength(1);
            expect(res.body.attempts[0].date).toBe(dailyPyqUtil.istDateKey());
            expect(res.body.attempts[0].score).toBe(8 * 4 - 1);
            expect(res.body.attempts[0].answers).toBeUndefined(); // summary only

            const other = await request(app).get('/api/daily-pyq/history').set(authHeader(otherToken));
            expect(other.body.total).toBe(1);
            expect(other.body.attempts[0].date).toBe(dailyPyqUtil.istDateKey());
        });
    });

    describe('GET /api/daily-pyq/attempts/:attemptId', () => {
        it('returns the owner\'s full attempt', async () => {
            const attempt = await DailyPyqAttempt.findOne({ student: student._id });
            const res = await request(app)
                .get(`/api/daily-pyq/attempts/${attempt._id}`)
                .set(authHeader(studentToken));
            expect(res.status).toBe(200);
            expect(res.body.attempt.answers).toHaveLength(10);
        });

        it('404s for another student\'s attempt (no existence leak)', async () => {
            const attempt = await DailyPyqAttempt.findOne({ student: student._id });
            const res = await request(app)
                .get(`/api/daily-pyq/attempts/${attempt._id}`)
                .set(authHeader(otherToken));
            expect(res.status).toBe(404);
        });

        it('400s on invalid ids', async () => {
            const res = await request(app)
                .get('/api/daily-pyq/attempts/not-an-id')
                .set(authHeader(studentToken));
            expect(res.status).toBe(400);
        });
    });

    describe('streaks', () => {
        it('counts consecutive completed IST days and resets across gaps', async () => {
            const todayKey = dailyPyqUtil.istDateKey();
            // Yesterday + day-before completed => current streak 3 with today.
            await DailyPyqAttempt.create([
                {
                    student: student._id,
                    date: dailyPyqUtil.addDaysKey(todayKey, -1),
                    questionIds: [],
                    answers: [],
                    totalQuestions: 10,
                    score: 30,
                    maxScore: 40
                },
                {
                    student: student._id,
                    date: dailyPyqUtil.addDaysKey(todayKey, -2),
                    questionIds: [],
                    answers: [],
                    totalQuestions: 10,
                    score: 20,
                    maxScore: 40
                }
            ]);

            const today = await request(app).get('/api/daily-pyq/today').set(authHeader(studentToken));
            expect(today.body.streak).toEqual({ current: 3, best: 3 });

            // Gap: a run from 5 days ago is broken by the missing day 3.
            await DailyPyqAttempt.create({
                student: student._id,
                date: dailyPyqUtil.addDaysKey(todayKey, -5),
                questionIds: [],
                answers: [],
                totalQuestions: 10,
                score: 10,
                maxScore: 40
            });
            const stats = await request(app).get('/api/daily-pyq/today').set(authHeader(studentToken));
            expect(stats.body.streak).toEqual({ current: 3, best: 3 });

            // A student whose only completion is today has current 1 (other user).
            const other = await request(app).get('/api/daily-pyq/today').set(authHeader(otherToken));
            expect(other.body.streak.current).toBe(1);
        });
    });

    describe('bank too small', () => {
        it('answers 503 when fewer than 10 active questions exist', async () => {
            // Isolate: drop sets/attempts, deactivate everything, seed 3.
            // Distinct prefix: the restore step below reactivates the whole
            // bank, so these must not share question text with earlier rows
            // (same subject + same text = same dedupKey once both active).
            await DailyPyqSet.deleteMany({});
            await DailyPyqAttempt.deleteMany({});
            await QuestionBank.updateMany({}, { $set: { isActive: false } });
            await seedQuestions(3, 'Small');

            const res = await request(app).get('/api/daily-pyq/today').set(authHeader(studentToken));
            expect(res.status).toBe(503);
            expect(res.body.code).toBe('DAILY_PYQ_UNAVAILABLE');

            // Restore the bank for any later suites.
            await QuestionBank.updateMany({}, { $set: { isActive: true } });
        });
    });
});
