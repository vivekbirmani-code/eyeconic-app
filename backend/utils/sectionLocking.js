// Section locking / sequential section navigation utilities.
//
// Shared by routes/quizzes.js (authenticated attempts) and
// routes/public-quiz.js (guest attempts). All deadline math is
// server-authoritative: a section's endsAt is stored on the attempt and every
// relevant request lazily cascades expired sections forward (there is no
// cron). The pure functions below operate on plain state arrays so they work
// identically for QuizAttempt and GuestAttempt documents.

const toIdString = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

// Normalizes sections and ensures question assignment exists for mixed sections.
const deriveSectionsForQuestions = (rawSections, rawQuestionIds, totalDuration, options = {}) => {
  const { strictDuration = true } = options;

  // An empty array means "no sections configured" (e.g. a legacy quiz being
  // edited) — same as omitting the field. It must not trip the duration check.
  if (rawSections === undefined || rawSections === null || rawSections === '' ||
      (Array.isArray(rawSections) && rawSections.length === 0)) {
    return { sections: [] };
  }

  let parsedSections = rawSections;
  if (typeof parsedSections === 'string') {
    try {
      parsedSections = JSON.parse(parsedSections);
    } catch {
      return { error: 'Invalid sections payload' };
    }
  }

  if (!Array.isArray(parsedSections)) {
    return { error: 'Sections must be an array' };
  }

  const questionIds = (rawQuestionIds || []).map(toIdString).filter(Boolean);
  const questionIdSet = new Set(questionIds);

  const sections = parsedSections.map((section, index) => ({
    name: String(section?.name || `Section ${index + 1}`).trim(),
    duration: Number(section?.duration) || 0,
    selectionType: section?.selectionType === 'manual' ? 'manual' : 'mixed',
    questions: Array.isArray(section?.questions)
      ? section.questions.map(toIdString).filter(id => id && questionIdSet.has(id))
      : []
  }));

  // Prevent duplicate question assignment across sections.
  const questionOwners = new Map();
  for (const section of sections) {
    const uniqueInSection = [...new Set(section.questions)];
    section.questions = uniqueInSection;

    for (const qid of uniqueInSection) {
      const owner = questionOwners.get(qid);
      if (owner) {
        return {
          error: `Question ${qid} is assigned to multiple sections (${owner} and ${section.name}).`
        };
      }
      questionOwners.set(qid, section.name);
    }
  }

  const invalidSection = sections.find(section => !section.name || section.duration <= 0);
  if (invalidSection) {
    return { error: 'Each section needs a valid name and duration' };
  }

  if (strictDuration && Number.isFinite(totalDuration) && totalDuration > 0) {
    const allocated = sections.reduce((sum, section) => sum + section.duration, 0);
    if (allocated !== totalDuration) {
      return {
        error: `Section duration total (${allocated}) must match quiz duration (${totalDuration})`
      };
    }
  }

  const mixedSections = sections.filter(section => section.selectionType === 'mixed');
  const assignedIds = new Set(
    sections.flatMap(section => section.questions).filter(id => questionIdSet.has(id))
  );
  const unassignedIds = questionIds.filter(id => !assignedIds.has(id));

  if (mixedSections.length > 0) {
    const qPerSection = Math.floor(unassignedIds.length / mixedSections.length);
    const remainder = unassignedIds.length % mixedSections.length;

    let startIndex = 0;
    mixedSections.forEach((section, idx) => {
      const count = qPerSection + (idx < remainder ? 1 : 0);
      const sectionQuestions = unassignedIds.slice(startIndex, startIndex + count);
      section.questions.push(...sectionQuestions);
      startIndex += count;
    });
  } else if (sections.length > 0 && unassignedIds.length > 0) {
    return {
      error: `All quiz questions must be assigned to sections. ${unassignedIds.length} question(s) are unassigned.`
    };
  }

  sections.forEach(section => {
    section.questions = [...new Set(section.questions)];
  });

  return { sections };
};

// True when an attempt enforces section locking. Legacy attempts (and attempts
// on quizzes without sections) never satisfy this — see the model comments.
const isSectionLockEnforced = (attemptLike) =>
  !!attemptLike &&
  attemptLike.sectionLockEnabled === true &&
  Array.isArray(attemptLike.sectionDefinitions) &&
  attemptLike.sectionDefinitions.length > 0;

// Resolves a quiz's sections to the canonical [{index, name, duration,
// questionIds}] shape. Uses the exact same derivation GET /quiz/:id performs
// for display, so pre-start previews and attempt snapshots agree. On config
// drift (a stored sections array that violates current rules) falls back to
// the raw sections filtered to known questions — never fail an in-flight
// attempt because of configuration drift.
const resolveQuizSections = (quiz) => {
  if (!quiz) return [];
  if (!quiz.sections || quiz.sections.length === 0) return [];
  const questionIds = (quiz.questions || []).map(toIdString).filter(Boolean);

  const result = deriveSectionsForQuestions(
    quiz.sections,
    questionIds,
    quiz.duration,
    { strictDuration: false }
  );

  if (result.error) {
    const known = new Set(questionIds);
    return (quiz.sections || [])
      .map((section, index) => ({
        index,
        name: String(section?.name || `Section ${index + 1}`).trim(),
        duration: Number(section?.duration) || 0,
        questionIds: (Array.isArray(section?.questions) ? section.questions : [])
          .map(toIdString)
          .filter(id => id && known.has(id)),
      }))
      .filter(section => section.questionIds.length > 0 || section.duration > 0);
  }

  return result.sections.map((section, index) => ({
    index,
    name: section.name,
    duration: section.duration,
    questionIds: section.questions,
  }));
};

// Builds the attempt-level snapshot written at /start. The definitions are
// immutable for the attempt's lifetime (immune to later admin edits); only
// sectionLockEnabled === false is written for quizzes that don't enforce.
const buildSectionSnapshot = (quiz, now = new Date()) => {
  const enabled = !!quiz && quiz.lockSectionsAfterSubmission !== false;
  if (!enabled) {
    return { sectionLockEnabled: false, sectionDefinitions: [], sectionStates: [] };
  }

  const sectionDefinitions = resolveQuizSections(quiz).map(section => ({
    index: section.index,
    name: section.name,
    duration: section.duration,
    questionIds: section.questionIds,
  }));

  if (sectionDefinitions.length === 0) {
    return { sectionLockEnabled: false, sectionDefinitions: [], sectionStates: [] };
  }

  const first = sectionDefinitions[0];
  const startedAt = new Date(now);
  return {
    sectionLockEnabled: true,
    sectionDefinitions,
    sectionStates: [{
      index: 0,
      status: 'in_progress',
      startedAt,
      endsAt: new Date(startedAt.getTime() + (Number(first.duration) || 0) * 60000),
    }],
  };
};

// questionId -> sectionIndex. Keyed by identity (not global array position)
// so an admin reordering quiz.questions mid-attempt cannot move an answer
// between sections.
const buildQuestionIdToSectionMap = (definitions) => {
  const map = new Map();
  (definitions || []).forEach((definition) => {
    (definition.questionIds || []).forEach((qid) => {
      map.set(String(qid), Number(definition.index));
    });
  });
  return map;
};

const sectionIndexForQuestionId = (definitions, questionId) => {
  if (!questionId) return -1;
  const map = buildQuestionIdToSectionMap(definitions);
  const idx = map.get(String(questionId));
  return idx === undefined ? -1 : idx;
};

const copyState = (state) => ({
  index: Number(state.index),
  status: state.status,
  ...(state.startedAt ? { startedAt: new Date(state.startedAt) } : {}),
  ...(state.endsAt ? { endsAt: new Date(state.endsAt) } : {}),
  ...(state.submittedAt ? { submittedAt: new Date(state.submittedAt) } : {}),
});

// Pure expiry cascade. Walks the definitions in order and closes every
// section whose stored deadline has passed, opening the next section at the
// closed section's endsAt (tight cascade — total time always equals the sum
// of section durations, and a student who was away loses exactly the elapsed
// time). Also repairs states lost to crashes between a section close and the
// next section's initialization. Returns plain arrays safe for $set.
const computeExpiryCascade = (definitions, states, now = new Date()) => {
  const ts = now.getTime();
  const orderedDefs = [...(definitions || [])].sort((a, b) => Number(a.index) - Number(b.index));
  const byIndex = new Map();
  (states || []).forEach((state) => byIndex.set(Number(state.index), copyState(state)));

  let changed = false;
  let firstClosedIndex = null;

  for (let i = 0; i < orderedDefs.length; i++) {
    const def = orderedDefs[i];
    const idx = Number(def.index);
    let state = byIndex.get(idx);

    if (!state) {
      if (i === 0) continue; // index 0 is always created at /start; nothing to infer it from
      const prev = byIndex.get(Number(orderedDefs[i - 1].index));
      if (!prev || prev.status === 'in_progress') break; // previous still open — nothing beyond may open
      const startedAt = prev.endsAt || prev.submittedAt || now;
      state = {
        index: idx,
        status: 'in_progress',
        startedAt: new Date(startedAt),
        endsAt: new Date(new Date(startedAt).getTime() + (Number(def.duration) || 0) * 60000),
      };
      byIndex.set(idx, state);
      changed = true;
    }

    if (state.status === 'in_progress' && state.endsAt && new Date(state.endsAt).getTime() <= ts) {
      state.status = 'auto_submitted';
      state.submittedAt = state.endsAt;
      changed = true;
      if (firstClosedIndex === null) firstClosedIndex = idx;
    }
  }

  const nextStates = orderedDefs
    .map((def) => byIndex.get(Number(def.index)))
    .filter(Boolean);
  const lastDef = orderedDefs[orderedDefs.length - 1];
  const lastState = lastDef ? byIndex.get(Number(lastDef.index)) : null;
  const exhausted = !!lastState &&
    lastState.status !== 'in_progress' &&
    nextStates.every((state) => state.status !== 'in_progress');

  return { states: nextStates, changed, firstClosedIndex, exhausted };
};

// Pure transition for an explicit section submission. Flips the target
// section to submitted/auto_submitted and opens the next section at `now`
// (or reports that this was the final section).
const computeSectionSubmit = (definitions, states, sectionIndex, isAutoSubmit, now = new Date()) => {
  const orderedDefs = [...(definitions || [])].sort((a, b) => Number(a.index) - Number(b.index));
  const target = (states || []).find((state) => Number(state.index) === Number(sectionIndex));
  if (!target) return { error: 'NOT_FOUND' };
  if (target.status !== 'in_progress') return { error: 'ALREADY_CLOSED', state: copyState(target) };

  const next = (states || []).map(copyState);
  const state = next.find((s) => Number(s.index) === Number(sectionIndex));
  state.status = isAutoSubmit === true ? 'auto_submitted' : 'submitted';
  state.submittedAt = new Date(now);

  const nextDef = orderedDefs.find((def) => Number(def.index) === Number(sectionIndex) + 1);
  if (!nextDef) {
    return { states: next, finalized: true };
  }

  const startedAt = new Date(now);
  const endsAt = new Date(startedAt.getTime() + (Number(nextDef.duration) || 0) * 60000);
  let nextState = next.find((s) => Number(s.index) === Number(nextDef.index));
  if (!nextState) {
    nextState = { index: Number(nextDef.index), status: 'in_progress' };
    next.push(nextState);
  }
  nextState.status = 'in_progress';
  nextState.startedAt = startedAt;
  nextState.endsAt = endsAt;
  next.sort((a, b) => a.index - b.index);

  return {
    states: next,
    finalized: false,
    nextSection: {
      index: Number(nextDef.index),
      name: nextDef.name,
      duration: Number(nextDef.duration) || 0,
      startedAt,
      endsAt,
      questionCount: (nextDef.questionIds || []).length,
    },
  };
};

// Closes every still-open section state (used by the defensive whole-quiz
// submit path so old clients can end an attempt early — they only forfeit
// the remaining questions; nothing is ever unlocked).
const closeSectionStates = (states, { status = 'submitted', at = new Date() } = {}) =>
  (states || []).map((state) => {
    if (state.status === 'in_progress') {
      return { ...copyState(state), status, submittedAt: new Date(at) };
    }
    return copyState(state);
  });

const allSectionsClosed = (definitions, states) => {
  const defs = definitions || [];
  if (defs.length === 0) return false;
  const lastIdx = Number(defs[defs.length - 1].index);
  const last = (states || []).find((state) => Number(state.index) === lastIdx);
  return !!last && last.status !== 'in_progress';
};

// Lazy, authoritative expiry engine shared by both attempt models.
// `filter` selects the attempt (e.g. {_id, student} or {_id, guestId, quiz});
// `finalize` is a route-supplied async (attempt, {isAutoSubmit}) => attempt
// callback that grades and finalizes the whole attempt (each route file owns
// its finalize — they differ in notifications/result payloads).
//
// Concurrency: the cascade's $set is guarded on the attempt still being
// in_progress and on the first section it closes still being open, so a
// concurrent manual submit (or sync) that wins the race forces a re-read;
// retries converge because the cascade is deterministic from stored
// deadlines.
const syncExpiredSections = async (AttemptModel, filter, options = {}, depth = 0) => {
  const { finalize, maxDepth = 4 } = options;

  let attempt = await AttemptModel.findOne(filter);
  if (!attempt) return { attempt: null, finalized: false };
  if (!isSectionLockEnforced(attempt) || attempt.status !== 'in_progress') {
    return { attempt, finalized: false };
  }

  const cascade = computeExpiryCascade(attempt.sectionDefinitions, attempt.sectionStates, new Date());

  if (cascade.changed) {
    const guard = cascade.firstClosedIndex !== null
      ? { [`sectionStates.${cascade.firstClosedIndex}.status`]: 'in_progress' }
      : {};
    const updated = await AttemptModel.findOneAndUpdate(
      { ...filter, status: 'in_progress', ...guard },
      { $set: { sectionStates: cascade.states } },
      { new: true }
    );
    if (updated) {
      attempt = updated;
    } else if (depth < maxDepth) {
      return syncExpiredSections(AttemptModel, filter, options, depth + 1);
    } else {
      const reread = await AttemptModel.findOne(filter);
      if (reread) attempt = reread;
    }
  }

  if (attempt.status !== 'in_progress') {
    return { attempt, finalized: true };
  }

  // Crash reconciliation: every section is closed (incl. expiry cascade that
  // exhausted the quiz) but the attempt was never finalized — finalize now.
  if (allSectionsClosed(attempt.sectionDefinitions, attempt.sectionStates)) {
    const lastIdx = Number(attempt.sectionDefinitions[attempt.sectionDefinitions.length - 1].index);
    const lastState = attempt.sectionStates.find((s) => Number(s.index) === lastIdx);
    const isAutoSubmit = !!lastState && lastState.status === 'auto_submitted';
    if (typeof finalize === 'function') {
      const finalizedAttempt = await finalize(attempt, { isAutoSubmit });
      if (finalizedAttempt) attempt = finalizedAttempt;
    }
    return { attempt, finalized: true };
  }

  return { attempt, finalized: false };
};

module.exports = {
  toIdString,
  deriveSectionsForQuestions,
  isSectionLockEnforced,
  resolveQuizSections,
  buildSectionSnapshot,
  buildQuestionIdToSectionMap,
  sectionIndexForQuestionId,
  computeExpiryCascade,
  computeSectionSubmit,
  closeSectionStates,
  allSectionsClosed,
  syncExpiredSections,
};
