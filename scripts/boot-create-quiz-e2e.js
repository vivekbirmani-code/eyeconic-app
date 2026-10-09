/**
 * Boot + seed backend for Create Quiz UI redesign verification.
 *
 * Starts the REAL backend (server.js) against an in-memory Mongo on port
 * 3000 — the exact origin the web bundle expects (EXPO_PUBLIC_API_URL=
 * http://localhost:3000/api) — and seeds everything the five-step Create
 * Quiz wizard needs:
 *
 *   - 1 admin, 1 mentor, 12 students (two with deliberately long
 *     names/emails to exercise row overflow)
 *   - 2 groups of students (group filters)
 *   - 3 subjects, 60+ questions with varied topic/tag/difficulty/type so
 *     Step 3 pagination (>50 = page 2), filters, and search all have data
 *
 * The process stays alive until killed. Credentials are printed on boot.
 *
 * Run from the repo root:  node scripts/boot-create-quiz-e2e.js
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'create-quiz-e2e-secret';
// The web dev bundle served by Metro :8090 must pass CORS.
process.env.ALLOWED_ORIGINS = 'http://localhost:8090,http://127.0.0.1:8090';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');
const PORT = Number(process.env.E2E_PORT || 3101);

const log = (...args) => console.log('[e2e-boot]', ...args);

const requireBackend = (modulePath) => require(path.join(BACKEND, modulePath));

async function main() {
  const { MongoMemoryServer } = require(path.join(
    BACKEND, 'node_modules', 'mongodb-memory-server'
  ));
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  log('in-memory mongo at', process.env.MONGODB_URI);

  // Require the real server AFTER env is pinned — dotenv never overrides
  // existing env vars, so the production Atlas URI in backend/.env is inert.
  const { server } = requireBackend('server');

  const User = requireBackend('models/User');
  const Subject = requireBackend('models/Subject');
  const QuestionBank = requireBackend('models/QuestionBank');
  const Group = requireBackend('models/Group');

  await new Promise((resolve) => server.listen(PORT, resolve));
  log(`backend listening on http://localhost:${PORT}/api`);
  log(`point the web bundle at it with EXPO_PUBLIC_API_URL=http://localhost:${PORT}/api`);

  // ---- Seed ----
  const subjects = await Promise.all(
    ['Anatomy', 'Physiology', 'Biochemistry'].map((name, i) =>
      Subject.create({ name, year: '1st', displayOrder: i + 1 })
    )
  );

  const difficulties = ['easy', 'medium', 'hard'];
  const types = ['mcq_single', 'assertion_reason', 'match_the_following', 'image_based', 'multiple_correct', 'numerical'];
  const topicsBySubject = {
    Anatomy: ['Upper Limb', 'Thorax', 'Neuroanatomy'],
    Physiology: ['Cardiovascular', 'Respiration', 'Renal'],
    Biochemistry: ['Enzymes', 'Metabolism', 'Genetics'],
  };
  const tagsPool = ['highyield', 'repeaters', 'ncert', 'clinical'];

  let qIndex = 0;
  for (let subjectIdx = 0; subjectIdx < subjects.length; subjectIdx += 1) {
    const subject = subjects[subjectIdx];
    const topics = topicsBySubject[subject.name];
    for (let i = 0; i < 24; i += 1) {
      qIndex += 1;
      await QuestionBank.create({
        subject: subject._id,
        topicName: topics[i % topics.length],
        subtopicName: 'Viva',
        system: 'General',
        questionType: types[qIndex % types.length],
        difficulty: difficulties[qIndex % difficulties.length],
        question: `E2E ${subject.name} question ${i + 1}: which statement about ${topics[i % topics.length]} is correct for verification pass ${qIndex}?`,
        options: ['Option A', 'Option B', 'Option C', 'Option D'],
        correctAnswer: qIndex % 4,
        tags: [tagsPool[qIndex % tagsPool.length]],
        marks: 4,
      });
    }
  }
  log(`seeded ${qIndex} questions across ${subjects.length} subjects`);

  const admin = await User.create({
    name: 'E2E Admin',
    email: 'e2e-admin@verify.test',
    password: 'password123',
    role: 'admin',
  });

  await User.create({
    name: 'E2E Mentor',
    email: 'e2e-mentor@verify.test',
    password: 'password123',
    role: 'mentor',
  });

  const studentNames = [
    'Ann First', 'Ben Second', 'Cy Third', 'Dee Fourth', 'Eli Fifth',
    'Fay Sixth', 'Gus Seventh', 'Hana Eighth', 'Ivan Ninth', 'Jade Tenth',
    // Deliberately long identity to exercise row overflow/clipping:
    'Kanimozhi Venkatanarasimharajuvaripeta Chaturvedi',
    'Lakshminarayanan Subramaniampillai',
  ];
  const students = [];
  for (const name of studentNames) {
    const email = name === 'Kanimozhi Venkatanarasimharajuvaripeta Chaturvedi'
      ? 'kanimozhi.venkatanarasimharajuvaripeta.chaturvedi.extremely.long.address@verify.test'
      : `${name.split(' ')[0].toLowerCase()}@verify.test`;
    students.push(await User.create({ name, email, password: 'password123', role: 'student' }));
  }

  await Group.create({
    name: 'Batch A Morning',
    type: 'general',
    description: 'Morning batch students',
    students: students.slice(0, 5).map((s) => s._id),
    members: students.slice(0, 5).map((s) => s._id),
    createdBy: admin._id,
  });
  await Group.create({
    name: 'Batch B Evening',
    type: 'general',
    description: 'Evening batch students',
    students: students.slice(5, 9).map((s) => s._id),
    members: students.slice(5, 9).map((s) => s._id),
    createdBy: admin._id,
  });
  log('seeded admin/mentor/12 students/2 groups');
  log('login: e2e-admin@verify.test / password123');
  log('seed complete — backend stays up until killed');
}

main().catch((err) => {
  console.error('[e2e-boot] fatal:', err);
  process.exit(1);
});
