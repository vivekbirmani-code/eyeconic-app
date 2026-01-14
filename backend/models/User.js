const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const studentProfileSchema = new mongoose.Schema({
  mbbsBatch: { type: String, trim: true },
  collegeName: { type: String, trim: true },
  attemptNo: { type: Number },
  batchType: { type: String, trim: true }, // FOUNDATION, etc.
  grandTestsGiven: { type: String, trim: true },
  averageCorrects: { type: String, trim: true },
  averageScore: { type: Number },
  weakestSubjects: { type: String, trim: true },
  targetBranch: { type: String, trim: true },
  subscriptions: { type: String, trim: true }
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['admin', 'mentor', 'student'],
    default: 'student'
  },
  phone: {
    type: String,
    trim: true
  },
  // Student-specific profile data
  studentProfile: studentProfileSchema,
  isProfileComplete: {
    type: Boolean,
    default: false
  },
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group'
  }],
  pushToken: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);