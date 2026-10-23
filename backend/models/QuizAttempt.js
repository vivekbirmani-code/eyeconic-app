const mongoose = require('mongoose');

// Historical snapshot of a question's classification at the moment the
// student answered it. This is intentionally decoupled from the live
// QuestionBank document so that later edits to a question (e.g. an admin
// reclassifying its Subtopic) never rewrite past analytics.
const metadataSnapshotSchema = new mongoose.Schema({
  subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject' },
  subjectName: { type: String },
  topicName: { type: String },
  subtopicName: { type: String },
  system: { type: String },
  questionType: { type: String },
  tags: { type: [String], default: [] },
  difficulty: { type: String }
}, { _id: false });

const answerSchema = new mongoose.Schema({
  questionIndex: {
    type: Number,
    required: true
  },
  // Stable identity of the QuestionBank document this answer belongs to.
  // Required for all answers created going forward; may be absent on
  // legacy answers created before this field existed.
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuestionBank'
  },
  // Shape depends on the question's questionType:
  //   mcq_single / image_based / assertion_reason -> Number
  //   multiple_correct                            -> Number[]
  //   match_the_following                         -> Object map
  //   numerical                                    -> Number
  // -1 (legacy) / null / undefined = unanswered.
  selectedAnswer: {
    type: mongoose.Schema.Types.Mixed,
    default: -1
  },
  isCorrect: {
    type: Boolean
  },
  markedForReview: {
    type: Boolean,
    default: false
  },
  timeSpent: {
    type: Number, // seconds spent on this question
    default: 0
  },
  // Populated server-side at submit time only. Never trust a client-submitted
  // metadataSnapshot for analytics or grading.
  metadataSnapshot: {
    type: metadataSnapshotSchema
  }
});

const sectionPerformanceSchema = new mongoose.Schema({
  sectionName: String,
  correct: { type: Number, default: 0 },
  incorrect: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  timeSpent: { type: Number, default: 0 },
  accuracy: { type: Number, default: 0 }  // Accuracy percentage for this section
});

const attemptSchema = new mongoose.Schema({
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true
  },
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  answers: [answerSchema],
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: {
    type: Date
  },
  status: {
    type: String,
    enum: ['in_progress', 'completed', 'auto_submitted'],
    default: 'in_progress'
  },
  score: {
    type: Number,
    default: 0
  },
  totalQuestions: {
    type: Number,
    default: 0
  },
  marksObtained: {
    type: Number,
    default: 0
  },
  totalMarks: {
    type: Number,
    default: 0
  },
  sectionPerformance: [sectionPerformanceSchema],

  // Tab switch tracking
  tabSwitchCount: {
    type: Number,
    default: 0
  },
  tabSwitchLog: [{
    type: Date
  }],

  // Retest workflow
  retestRequested: {
    type: Boolean,
    default: false
  },
  retestRequestedAt: {
    type: Date
  },
  retestApproved: {
    type: Boolean,
    default: false
  },
  retestApprovedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  retestApprovedAt: {
    type: Date
  },
  retestUsed: {
    type: Boolean,
    default: false
  },
  
  // Audit trail: shareSolution setting at time of submission
  // NOTE: This is for admin audit only, not used for student visibility
  // Student visibility is determined by current quiz.shareSolution value (dynamic rule)
  shareSolutionAtSubmission: {
    type: Boolean,
    default: true
  },

  // ===== Server-authoritative duration (plan §7.5, decision D12) =====
  // Computed server-side at /start for FLAT (non-section-locked) attempts:
  // startTime + quiz duration. Section-locked attempts never set this — their
  // authority remains sectionStates[].endsAt (utils/sectionLocking.js).
  // Clients receive it for display-only countdowns; enforcement compares
  // server time against it on every attempt touch (lazy finalize).
  durationDeadline: {
    type: Date
  },

  // ===== Proctoring policy snapshot (frozen at /start, plan §21.1) =====
  // {version, hash, policy, frozenAt}. Write-once: created together with the
  // attempt and NEVER rewritten — later admin edits of quiz.proctoring cannot
  // move goalposts for an in-flight attempt (mirrors sectionDefinitions).
  proctoringSnapshot: {
    type: mongoose.Schema.Types.Mixed
  },

  // Machine-readable reason recorded when an attempt ends auto_submitted by
  // the server: {kind:'duration', deadline, detectedAt} today; policy rules
  // add {kind:'policy', ruleId, ...} in a later phase. Absent for manual
  // submits and client-timer auto-submits within the allowed window.
  autoSubmitReason: {
    type: mongoose.Schema.Types.Mixed
  },
  // Phase 7 (§26.5): mirror of the proctoring session's integrity status so
  // result/analytics surfaces can filter without a join. Written only by the
  // proctoring layer (session close + review decisions).
  integrityStatus: {
    type: String,
    enum: ['pending', 'clean', 'reviewed_ok', 'reviewed_concern'],
    default: 'pending',
  },

  // ===== Section locking (snapshot copied from the quiz at /start) =====
  // Deliberately defaults to false: attempts created before this feature (and
  // attempts on quizzes without sections) must keep free-navigation behavior.
  // /start writes true explicitly when the quiz resolves to locking ON with
  // sections present. Enforcement predicate everywhere:
  //   attempt.sectionLockEnabled === true && sectionDefinitions?.length > 0
  sectionLockEnabled: {
    type: Boolean,
    default: false
  },
  // Immutable per-attempt section definitions — the enforcement truth, immune
  // to later admin edits of quiz.sections. questionIds reference the quiz's
  // global question list by identity (not index), so reordering is tolerated.
  sectionDefinitions: [{
    _id: false,
    index: { type: Number, required: true },
    name: { type: String },
    duration: { type: Number }, // minutes
    questionIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionBank'
    }]
  }],
  // Mutable per-section progress. A section's startedAt is write-once (set
  // when the previous section closes) which makes it a safe optimistic-lock
  // token for transitions. endsAt = startedAt + duration (server-authoritative).
  sectionStates: [{
    _id: false,
    index: { type: Number, required: true },
    status: {
      type: String,
      enum: ['in_progress', 'submitted', 'auto_submitted'],
      default: 'in_progress'
    },
    startedAt: { type: Date },
    endsAt: { type: Date },
    submittedAt: { type: Date }
  }]
}, {
  timestamps: true
});

// Indexes for efficient queries
attemptSchema.index({ quiz: 1, student: 1 });
attemptSchema.index({ student: 1, status: 1 });
attemptSchema.index({ student: 1, status: 1, endTime: -1 });
attemptSchema.index({ retestRequested: 1, retestApproved: 1 });
attemptSchema.index({ student: 1, 'answers.questionId': 1 });
// Per-quiz terminal-status cohort: the leaderboard endpoint, the analytics
// test list counts and the overdue-attempt sweep all filter {quiz, status}
// (mirrors GuestAttempt's quiz_1_status_1_guest_1). Non-unique — auto-built
// at boot, no migration.
attemptSchema.index({ quiz: 1, status: 1 });

module.exports = mongoose.model('QuizAttempt', attemptSchema);