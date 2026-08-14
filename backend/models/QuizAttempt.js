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
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
attemptSchema.index({ quiz: 1, student: 1 });
attemptSchema.index({ student: 1, status: 1 });
attemptSchema.index({ retestRequested: 1, retestApproved: 1 });

module.exports = mongoose.model('QuizAttempt', attemptSchema);