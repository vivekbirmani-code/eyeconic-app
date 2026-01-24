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
  assignedStudents: [{
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
  }
}, {
  timestamps: true
});

// Auto-calculate total marks before saving
quizSchema.pre('save', async function (next) {
  if (this.isModified('questions')) {
    const QuestionBank = mongoose.model('QuestionBank');
    const questions = await QuestionBank.find({ _id: { $in: this.questions } });
    this.totalMarks = questions.reduce((sum, q) => sum + (q.marks || 1), 0);
  }
  next();
});

// Indexes
quizSchema.index({ subject: 1, testType: 1 });
quizSchema.index({ assignedStudents: 1, isActive: 1 });
quizSchema.index({ createdBy: 1 });

module.exports = mongoose.model('Quiz', quizSchema);