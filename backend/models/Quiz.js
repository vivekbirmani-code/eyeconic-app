const mongoose = require('mongoose');

const quizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true
  },
  testType: {
    type: String,
    enum: ['daily', 'weekly', 'grand'],
    required: true
  },
  duration: {
    type: Number, // in minutes
    required: true
  },
  instructions: [{
    type: String
  }],
  questions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QuestionBank'
  }],
  totalMarks: {
    type: Number,
    default: 0
  },
  positiveMarks: {
    type: Number,
    default: 4
  },
  negativeMarks: {
    type: Number,
    default: 1
  },
  assignedStudents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  assignedMentors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  scheduledDate: {
    type: Date
  },
  expiryDate: {
    type: Date
  },
  // Public sharing fields
  shareToken: {
    type: String,
    unique: true,
    sparse: true  // Allows multiple null values
  },
  isPublic: {
    type: Boolean,
    default: false
  },
  publicExpiryDate: {
    type: Date
  },
  // Solution sharing control
  shareSolution: {
    type: Boolean,
    default: true
  },
  // Quiz Sections (NEET style)
  sections: [{
    name: {
      type: String,
      required: true
    },
    duration: {
      type: Number, // duration in minutes for this specific section
      required: true
    },
    selectionType: {
      type: String,
      enum: ['mixed', 'manual'],
      default: 'manual'
    },
    questions: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'QuestionBank'
    }]
  }]
}, {
  timestamps: true
});

// Auto-calculate total marks before saving
quizSchema.pre('save', async function (next) {
  if (this.isModified('questions') || this.isModified('positiveMarks')) {
    const questionCount = this.questions ? this.questions.length : 0;
    this.totalMarks = questionCount * (this.positiveMarks || 4);
  }
  next();
});

// Indexes
quizSchema.index({ subject: 1, testType: 1 });
quizSchema.index({ assignedStudents: 1, isActive: 1 });
quizSchema.index({ assignedMentors: 1, isActive: 1 });
quizSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Quiz', quizSchema);