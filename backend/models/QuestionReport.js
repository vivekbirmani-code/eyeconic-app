const mongoose = require('mongoose');

// Compact snapshot of the question as the student saw it at report time.
// Deliberately minimal (text + type only): enough triage context if the
// QuestionBank doc is later edited or soft-deleted, without duplicating
// options/answer keys into a student-writable collection. Mirrors the
// metadataSnapshot philosophy on QuizAttempt answers.
const questionSnapshotSchema = new mongoose.Schema({
  question: { type: String, default: '' },
  questionType: { type: String, default: '' },
  // False when the QuestionBank doc was already gone at report time — the
  // report stays traceable via the stored question ref, honestly marked.
  available: { type: Boolean, default: true },
}, { _id: false });

// Student-submitted report about a possibly incorrect/ambiguous/incomplete
// question, filed from inside an active quiz attempt. Identity is trusted
// server-side only (auth context + the attempt/quiz/question refs resolved
// from the attempt's quiz) — never from client-supplied ids.
const questionReportSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  quiz: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true
  },
  attempt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuizAttempt',
    required: true
  },
  question: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuestionBank',
    required: true
  },
  // Position in the quiz's question list at report time (informational —
  // identity always travels via the question ref above).
  questionIndex: {
    type: Number,
    required: true
  },
  comment: {
    type: String,
    required: true,
    trim: true,
    maxlength: [1000, 'Comment must be 1000 characters or fewer']
  },
  questionSnapshot: {
    type: questionSnapshotSchema,
    default: () => ({})
  },
  status: {
    type: String,
    enum: ['open', 'resolved', 'dismissed'],
    default: 'open'
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resolvedAt: {
    type: Date
  },
  resolutionNote: {
    type: String,
    trim: true,
    maxlength: [1000, 'Resolution note must be 1000 characters or fewer']
  }
}, {
  timestamps: true
});

// Review surfaces query by status, recency, or quiz.
questionReportSchema.index({ status: 1, createdAt: -1 });
questionReportSchema.index({ quiz: 1, createdAt: -1 });
questionReportSchema.index({ attempt: 1, question: 1, status: 1 });
// DB-level backstop for the route's check-then-insert race (double-tap
// Submit, offline retry): at most ONE OPEN report per question per attempt.
// Resolved/dismissed reports drop out of the partial index, so a fresh
// report can be filed afterwards.
questionReportSchema.index(
  { attempt: 1, question: 1 },
  {
    unique: true,
    name: 'one_open_report_per_attempt_question',
    partialFilterExpression: { status: 'open' }
  }
);

module.exports = mongoose.model('QuestionReport', questionReportSchema);
