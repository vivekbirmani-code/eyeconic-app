/**
 * TEMPORARY Phase 4 §40.4 device-acceptance driver v3 (FINAL) — NOT committed.
 * Real backend (server.js) on :3000 + :3100, in-memory Mongo, gates ON,
 * fixed seed (alphanumeric password), RAM-based request log surfaced at
 * :3101/requests (no stdout, no filesystem), :3101/state for DB truth.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase4-device-run-secret';
process.env.PORT = '3100';

const path = require('path');
const http = require('http');
const express = require(path.join(__dirname, '..', 'node_modules', 'express'));

const BACKEND = path.resolve(__dirname, '..');
const requests = []; // RAM only — immune to every pipe/file failure mode

async function main() {
  const { MongoMemoryServer } = require(path.join(BACKEND, 'node_modules', 'mongodb-memory-server'));
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();

  const { app, server } = require(path.join(BACKEND, 'server'));

  const traceRequest = (req, res) => {
    const entry = { at: new Date().toISOString(), method: req.method, url: req.url, status: null };
    requests.push(entry);
    if (requests.length > 500) requests.shift();
    res.on('finish', () => { entry.status = res.statusCode; });
  };
  server.on('request', traceRequest);
  const server3000 = http.createServer(app);
  server3000.on('request', traceRequest);
  await new Promise((resolve) => server.listen(3100, resolve));
  await new Promise((resolve) => server3000.listen(3000, resolve));
  console.log('[driver] backend on :3100 and :3000');

  const User = require(path.join(BACKEND, 'models/User'));
  const Subject = require(path.join(BACKEND, 'models/Subject'));
  const QuestionBank = require(path.join(BACKEND, 'models/QuestionBank'));
  const Quiz = require(path.join(BACKEND, 'models/Quiz'));
  const QuizAttempt = require(path.join(BACKEND, 'models/QuizAttempt'));
  const ProctoringSession = require(path.join(BACKEND, 'models/ProctoringSession'));
  const ProctoringEvent = require(path.join(BACKEND, 'models/ProctoringEvent'));
  const { setProctoringEnabled } = require(path.join(BACKEND, 'utils/appSettings'));

  const subject = await Subject.create({ name: 'P4 Device Pathology', year: '1st', displayOrder: 1 });
  const questions = [];
  for (let i = 0; i < 3; i++) {
    questions.push(await QuestionBank.create({
      subject: subject._id, topicName: 'Genetics', subtopicName: 'Mendelian',
      system: 'Disorders', questionType: 'mcq_single', difficulty: 'medium',
      question: `P4 device Q${i + 1}?`, options: ['A', 'B', 'C', 'D'], correctAnswer: 1,
    }));
  }
  const admin = await User.create({ name: 'P4 Admin', email: 'p4admin@run.test', password: 'P4passw0rd23', role: 'admin' });
  const student = await User.create({ name: 'P4 Student', email: 'p4device@run.test', password: 'P4passw0rd23', role: 'student' });
  const quiz = await Quiz.create({
    title: 'P4 Device Acceptance Quiz', subject: subject._id, testType: 'daily', duration: 20,
    questions: questions.map((q) => q._id), positiveMarks: 4, negativeMarks: 1,
    assignedStudents: [student._id], createdBy: admin._id,
    proctoring: { enabled: true, camera: 'optional' },
  });
  await setProctoringEnabled(true, admin._id);
  console.log('[driver] seeded p4device@run.test / P4passw0rd23');

  const sidecar = express();
  sidecar.get('/requests', (_req, res) => res.json(requests));
  sidecar.get('/state', async (_req, res) => {
    try {
      const sessions = await ProctoringSession.find({}).lean();
      const events = await ProctoringEvent.find({}).lean();
      const attempts = await QuizAttempt.find({}).lean();
      const byType = {};
      for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
      res.json({
        seeded: { studentEmail: student.email, password: 'P4passw0rd23', quizId: String(quiz._id) },
        attempts: attempts.map((a) => ({
          id: String(a._id), status: a.status, hasSnapshot: Boolean(a.proctoringSnapshot),
          tabSwitchCount: a.tabSwitchCount || 0,
        })),
        totalEvents: events.length,
        eventsByType: byType,
        appBackgroundEpisodes: events
          .filter((e) => e.type === 'APP_BACKGROUND')
          .map((e) => ({ durationMs: e.durationMs, pattern: e.metadata?.pattern ?? null })),
        sessions: sessions.map((s) => ({
          id: String(s._id), status: s.status, lastSeenAt: s.sessionHealth?.lastSeenAt ?? null,
          missedIntervals: s.sessionHealth?.missedIntervals ?? 0,
          heartbeatsMissed: s.integrity?.heartbeatsMissed ?? 0,
          deterrence: s.deterrence ?? null,
          eventCounts: s.eventCounts ?? {},
          transitions: (s.transitions || []).map((t) => `${t.from}->${t.to}:${t.reason}`),
        })),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  sidecar.listen(3101, () => console.log('[driver] sidecar :3101 (/state, /requests)'));
}

main().catch((error) => {
  console.error('[driver] fatal', error);
  process.exit(1);
});
