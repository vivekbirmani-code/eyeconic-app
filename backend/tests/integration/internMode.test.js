process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser } = require('../helpers/testApp');
const VideoCatalogItem = require('../../models/VideoCatalogItem');
const User = require('../../models/User');

let app;
let mentor;
let student;

beforeAll(async () => {
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
  mentor = await createUser({ role: 'mentor', name: 'Mentor One' });
  student = await createUser({ role: 'student', name: 'Intern One' });
});

/* ---------------- fixtures & helpers ---------------- */

const CATALOG = [
  // sheetRow mirrors the real contract: watch order = Excel row order.
  { sheetRow: 2, source: 'MARROW', subject: 'ANATOMY', type: 'Main Videos', title: 'GAMETOGENESIS', durationMin: 30 },
  { sheetRow: 3, source: 'MARROW', subject: 'ANATOMY', type: 'Main Videos', title: 'WEEKS OF DEVELOPMENT', durationMin: 45 },
  { sheetRow: 4, source: 'MARROW', subject: 'ANATOMY', type: 'Main Videos', title: 'HISTOLOGY PART 1', durationMin: 45 },
  { sheetRow: 5, source: 'MARROW', subject: 'ANATOMY', type: 'Main Videos', title: 'HISTOLOGY PART 2', durationMin: 50 },
  { sheetRow: 6, source: 'MARROW', subject: 'PHYSIOLOGY', type: 'Main Videos', title: 'HOMEOSTASIS', durationMin: 40 },
  { sheetRow: 7, source: 'PrepLadder', subject: 'MEDICINE', type: 'MAIN VIDEOS', title: 'CARDIOLOGY INTRO', durationMin: 60 },
  { sheetRow: 8, source: 'PrepLadder', subject: 'MEDICINE', type: 'MAIN VIDEOS', title: 'ECG BASICS', durationMin: 30 }
];

const seedCatalog = (rows = CATALOG) =>
  VideoCatalogItem.insertMany(
    rows.map((r) => ({
      seriesKey: `${r.subject}${r.type}${r.source}`,
      source: r.source,
      sourceKey: r.source.toLowerCase(),
      subject: r.subject,
      type: r.type,
      title: r.title,
      durationMin: r.durationMin,
      sheetRow: r.sheetRow,
      dedupKey: `${r.subject}${r.type}${r.source}|${r.title}`,
      isActive: true
    }))
  );

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

const configureIntern = (scope, token = mentor.token, studentId = student.user._id) =>
  request(app)
    .put(`/api/intern/config/${studentId}`)
    .set(authHeader(token))
    .send({ isIntern: true, scope });

const setTime = (minutes, token = student.token) =>
  request(app)
    .post('/api/intern/time')
    .set(authHeader(token))
    .send({ minutes });

const titlesOf = (res) => res.body.plan.map((t) => t.title);

const markWatched = (taskId, token = student.token) =>
  request(app)
    .post(`/api/intern/tasks/${taskId}/watched`)
    .set(authHeader(token))
    .send({});

const MARROW_ANATOMY_SCOPE = [{ sourceKey: 'marrow', subjects: ['ANATOMY'] }];

/* ---------------- catalog summary ---------------- */

describe('GET /api/intern/catalog/summary', () => {
  it('groups sources with per-subject counts for the mentor pickers', async () => {
    await seedCatalog();
    const res = await request(app)
      .get('/api/intern/catalog/summary')
      .set(authHeader(mentor.token));

    expect(res.status).toBe(200);
    const marrow = res.body.sources.find((s) => s.sourceKey === 'marrow');
    expect(marrow.source).toBe('MARROW');
    expect(marrow.videos).toBe(5);
    const anatomy = marrow.subjects.find((s) => s.subject === 'ANATOMY');
    expect(anatomy.videos).toBe(4);
    expect(anatomy.minutes).toBe(170);
    const prepladder = res.body.sources.find((s) => s.sourceKey === 'prepladder');
    expect(prepladder.subjects).toHaveLength(1);
  });

  it('rejects students', async () => {
    const res = await request(app)
      .get('/api/intern/catalog/summary')
      .set(authHeader(student.token));
    expect(res.status).toBe(403);
  });
});

/* ---------------- intern config ---------------- */

describe('PUT /api/intern/config/:studentId', () => {
  beforeEach(async () => {
    await seedCatalog();
  });

  it('mentor toggles a student on with a multi-source scope', async () => {
    const res = await configureIntern([
      { sourceKey: 'marrow', subjects: ['ANATOMY', 'PHYSIOLOGY'] },
      { sourceKey: 'prepladder', subjects: ['MEDICINE'] }
    ]);

    expect(res.status).toBe(200);
    expect(res.body.isIntern).toBe(true);
    expect(
      res.body.scope.map((s) => ({ source: s.source, sourceKey: s.sourceKey, subjects: s.subjects }))
    ).toEqual([
      { source: 'MARROW', sourceKey: 'marrow', subjects: ['ANATOMY', 'PHYSIOLOGY'] },
      { source: 'PrepLadder', sourceKey: 'prepladder', subjects: ['MEDICINE'] }
    ]);

    const saved = await User.findById(student.user._id);
    expect(saved.isIntern).toBe(true);
    expect(saved.internScope).toHaveLength(2);
  });

  it('rejects an unknown source', async () => {
    const res = await configureIntern([{ sourceKey: 'nope', subjects: ['ANATOMY'] }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/unknown video source/i);
  });

  it('rejects a subject the source does not teach', async () => {
    const res = await configureIntern([{ sourceKey: 'marrow', subjects: ['SURGERY'] }]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not available in MARROW: SURGERY/i);
  });

  it('rejects an empty scope when toggling on', async () => {
    const res = await configureIntern([]);
    expect(res.status).toBe(400);
  });

  it('toggle-off keeps the scope for a later re-toggle', async () => {
    await configureIntern(MARROW_ANATOMY_SCOPE);
    const off = await request(app)
      .put(`/api/intern/config/${student.user._id}`)
      .set(authHeader(mentor.token))
      .send({ isIntern: false });

    expect(off.status).toBe(200);
    expect(off.body.isIntern).toBe(false);
    expect(off.body.scope).toHaveLength(1);

    const saved = await User.findById(student.user._id);
    expect(saved.isIntern).toBe(false);
    expect(saved.internScope).toHaveLength(1);
  });

  it('rejects students configuring anyone', async () => {
    const res = await configureIntern(MARROW_ANATOMY_SCOPE, student.token);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/intern/config/:studentId', () => {
  it('student may read their own config; other students may not', async () => {
    await seedCatalog();
    await configureIntern(MARROW_ANATOMY_SCOPE);

    const own = await request(app)
      .get(`/api/intern/config/${student.user._id}`)
      .set(authHeader(student.token));
    expect(own.status).toBe(200);
    expect(own.body.isIntern).toBe(true);
    expect(own.body.progress.scopeVideos).toBe(4);

    const other = await createUser({ role: 'student', name: 'Other Student' });
    const denied = await request(app)
      .get(`/api/intern/config/${student.user._id}`)
      .set(authHeader(other.token));
    expect(denied.status).toBe(403);
  });

  it('includes today\'s slicer entry for the mentor progress view', async () => {
    await seedCatalog();
    await configureIntern(MARROW_ANATOMY_SCOPE);
    await setTime(120);

    const res = await request(app)
      .get(`/api/intern/config/${student.user._id}`)
      .set(authHeader(mentor.token));

    expect(res.status).toBe(200);
    expect(res.body.today).toMatchObject({ minutes: 120, planCount: 3 });
  });
});

/* ---------------- allocation ---------------- */

describe('POST /api/intern/time (allocation)', () => {
  beforeEach(async () => {
    await seedCatalog();
    await configureIntern(MARROW_ANATOMY_SCOPE);
  });

  it('fills the budget in sheet order and stops strictly before overflow', async () => {
    // Budget 105: 30 + 45 = 75; the next 45 would make 120 > 105 -> excluded.
    const res = await setTime(105);

    expect(res.status).toBe(200);
    expect(titlesOf(res)).toEqual(['GAMETOGENESIS', 'WEEKS OF DEVELOPMENT']);
    expect(res.body.totalMinutes).toBe(75);
    expect(res.body.plan.every((t) => t.status === 'pending')).toBe(true);
    expect(res.body.nextVideo.title).toBe('HISTOLOGY PART 1');
    expect(res.body.reason).toBeNull();
  });

  it('exact fit includes the closing video', async () => {
    // 30 + 45 + 45 = 120 exactly.
    const res = await setTime(120);
    expect(titlesOf(res)).toEqual(['GAMETOGENESIS', 'WEEKS OF DEVELOPMENT', 'HISTOLOGY PART 1']);
    expect(res.body.totalMinutes).toBe(120);
    expect(res.body.nextVideo.title).toBe('HISTOLOGY PART 2');
  });

  it('never crosses the limit even for a single video', async () => {
    // Watch the 30-min opener first; the next unwatched needs 45, budget 30
    // -> zero videos + friendly reason.
    const warmup = await setTime(30); // exactly fits GAMETOGENESIS
    expect(titlesOf(warmup)).toEqual(['GAMETOGENESIS']);
    await markWatched(warmup.body.plan[0]._id);

    const res = await setTime(30);
    expect(res.status).toBe(200);
    expect(res.body.plan).toHaveLength(0);
    expect(res.body.reason).toBe('NEXT_VIDEO_LONGER_THAN_TIME');
    expect(res.body.nextVideo.durationMin).toBe(45);
  });

  it('validates the slicer range and step', async () => {
    expect((await setTime(15)).status).toBe(400); // below 30
    expect((await setTime(735)).status).toBe(400); // above 720
    expect((await setTime(37)).status).toBe(400); // not a 15-min step
    expect((await setTime('90')).status).toBe(200); // numeric string coerces
  });

  it('re-choosing the same day recomputes the plan but keeps tasks', async () => {
    const first = await setTime(120); // 3 videos
    expect(first.body.plan).toHaveLength(3);

    const second = await setTime(60); // only the first video fits now
    expect(titlesOf(second)).toEqual(['GAMETOGENESIS']);
    expect(second.body.totalMinutes).toBe(30);

    // The other two remain as pending carry-over tasks.
    const tasks = await request(app)
      .get('/api/intern/tasks')
      .set(authHeader(student.token));
    expect(tasks.body.tasks).toHaveLength(3);
    expect(tasks.body.today.videoIds).toHaveLength(1);
  });

  it('starts at the first UNWATCHED video (carry-over across days)', async () => {
    await setTime(120); // 3 videos
    const { plan } = (await setTime(120)).body;
    await markWatched(plan[0]._id); // GAMETOGENESIS done

    const next = await setTime(90); // 45 + 45 = 90, starts at WEEKS
    expect(titlesOf(next)).toEqual(['WEEKS OF DEVELOPMENT', 'HISTOLOGY PART 1']);
    expect(next.body.plan[0].status).toBe('pending'); // task reused, not duplicated
  });

  it('reports the finished playlist once everything is watched', async () => {
    // Scope total is 170 minutes.
    const full = await setTime(165); // 30+45+45 = 120, 50 does not fit
    for (const t of full.body.plan) await markWatched(t._id);
    const rest = await setTime(90); // 50 (HISTOLOGY PART 2) fits
    expect(titlesOf(rest)).toEqual(['HISTOLOGY PART 2']);
    await markWatched(rest.body.plan[0]._id);

    const done = await setTime(60);
    expect(done.body.plan).toHaveLength(0);
    expect(done.body.reason).toBe('PLAYLIST_FINISHED');

    const me = await request(app)
      .get('/api/intern/me')
      .set(authHeader(student.token));
    expect(me.body.finishedAll).toBe(true);
  });

  it('respects per-source subject scoping and multi-source sheet order', async () => {
    await request(app)
      .put(`/api/intern/config/${student.user._id}`)
      .set(authHeader(mentor.token))
      .send({
        isIntern: true,
        scope: [
          { sourceKey: 'prepladder', subjects: ['MEDICINE'] },
          { sourceKey: 'marrow', subjects: ['ANATOMY'] }
        ]
      });

    // Anatomy rows (2-5) precede PrepLadder rows (7-8) in sheet order.
    const res = await setTime(240);
    expect(titlesOf(res)).toEqual([
      'GAMETOGENESIS',
      'WEEKS OF DEVELOPMENT',
      'HISTOLOGY PART 1',
      'HISTOLOGY PART 2',
      'CARDIOLOGY INTRO'
    ]);
    expect(res.body.totalMinutes).toBe(230); // 60+30 would cross 240? no: +60 = 290 -> stop
  });

  it('rejects non-intern students', async () => {
    const outsider = await createUser({ role: 'student', name: 'Not Intern' });
    const res = await setTime(60, outsider.token);
    expect(res.status).toBe(403);
  });
});

/* ---------------- tasks ---------------- */

describe('GET /api/intern/tasks + POST /tasks/:id/watched', () => {
  beforeEach(async () => {
    await seedCatalog();
    await configureIntern(MARROW_ANATOMY_SCOPE);
    await setTime(120);
  });

  it('lists tasks in playlist order with the day plan attached', async () => {
    const res = await request(app)
      .get('/api/intern/tasks')
      .set(authHeader(student.token));

    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t) => t.title)).toEqual([
      'GAMETOGENESIS',
      'WEEKS OF DEVELOPMENT',
      'HISTOLOGY PART 1'
    ]);
    expect(res.body.tasks[0]).toMatchObject({
      subject: 'ANATOMY',
      source: 'MARROW',
      type: 'Main Videos',
      durationMin: 30,
      status: 'pending'
    });
    expect(res.body.today.minutes).toBe(120);
  });

  it('marks a task watched (idempotent) and stamps watchedAt', async () => {
    const { plan } = (await request(app)
      .get('/api/intern/me')
      .set(authHeader(student.token))).body.today;

    const first = await markWatched(plan[0]._id);
    expect(first.body.status).toBe('watched');
    expect(first.body.watchedAt).toBeTruthy();

    const again = await markWatched(plan[0]._id);
    expect(again.body.status).toBe('watched');
  });

  it('a student cannot watch someone else\'s task', async () => {
    const { plan } = (await request(app)
      .get('/api/intern/me')
      .set(authHeader(student.token))).body.today;

    // The other student must themselves be an intern, otherwise the 403
    // intern check fires before the task-ownership 404 this test targets.
    const other = await createUser({ role: 'student', name: 'Other Student' });
    await configureIntern(MARROW_ANATOMY_SCOPE, mentor.token, other.user._id);
    const res = await markWatched(plan[0]._id, other.token);
    expect(res.status).toBe(404);
  });
});

/* ---------------- mentor overview ---------------- */

describe('GET /api/intern/students', () => {
  it('shows interns with progress and today\'s slicer choice', async () => {
    await seedCatalog();
    await configureIntern(MARROW_ANATOMY_SCOPE);
    await setTime(120);
    const { body } = await setTime(120);
    await markWatched(body.plan[0]._id);

    const res = await request(app)
      .get('/api/intern/students')
      .set(authHeader(mentor.token));

    expect(res.status).toBe(200);
    expect(res.body.interns).toHaveLength(1);
    const intern = res.body.interns[0];
    expect(intern.name).toBe('Intern One');
    expect(intern.today).toMatchObject({ minutes: 120, planCount: 3 });
    expect(intern.progress).toMatchObject({
      watchedCount: 1,
      watchedMinutes: 30,
      pendingCount: 2,
      scopeVideos: 4,
      finishedAll: false
    });
  });

  it('rejects students', async () => {
    const res = await request(app)
      .get('/api/intern/students')
      .set(authHeader(student.token));
    expect(res.status).toBe(403);
  });
});

/* ---------------- /me ---------------- */

describe('GET /api/intern/me', () => {
  it('answers plainly for non-interns (app hides the slicer)', async () => {
    const res = await request(app)
      .get('/api/intern/me')
      .set(authHeader(student.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isIntern: false });
  });

  it('shows scope, today plan and the blocking next video', async () => {
    await seedCatalog();
    await configureIntern(MARROW_ANATOMY_SCOPE);
    const warmup = await setTime(30);
    await markWatched(warmup.body.plan[0]._id);
    await setTime(30); // now a zero-fit day (next video needs 45)

    const res = await request(app)
      .get('/api/intern/me')
      .set(authHeader(student.token));

    expect(res.status).toBe(200);
    expect(res.body.isIntern).toBe(true);
    expect(res.body.today.plan).toHaveLength(0);
    expect(res.body.today.minutes).toBe(30);
    expect(res.body.finishedAll).toBe(false);
  });
});
