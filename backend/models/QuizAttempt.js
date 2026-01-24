const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  questionIndex: {
    type: Number,
    required: true
  },
  selectedAnswer: {
    type: Number,
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
  }
});

const sectionPerformanceSchema = new mongoose.Schema({
  sectionName: String,
  correct: { type: Number, default: 0 },
  incorrect: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  timeSpent: { type: Number, default: 0 }
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
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
attemptSchema.index({ quiz: 1, student: 1 });
attemptSchema.index({ student: 1, status: 1 });
attemptSchema.index({ retestRequested: 1, retestApproved: 1 });

module.exports = mongoose.model('QuizAttempt', attemptSchema);