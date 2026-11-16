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

const freeUserProfileSchema = new mongoose.Schema({
  year: { type: String, trim: true },
  issues: { type: String, trim: true },
  resources: [{ type: String }],
  isReadyToTransform: { type: Boolean, default: false }
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
  isFreeUser: {
    type: Boolean,
    default: false
  },
  // Student-specific profile data
  studentProfile: studentProfileSchema,
  freeUserProfile: freeUserProfileSchema,
  isProfileComplete: {
    type: Boolean,
    default: false
  },
  groups: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group'
  }],
  unseenQuizzes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz'
  }],
  pushToken: {
    type: String,
    default: null
  },
  fcmToken: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  mentors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  profilePicture: {
    type: String,
    default: null
  },
  profilePicturePublicId: {
    type: String,
    default: null
  },
  // Intern Mode (2026-11): a mentor/admin toggles a student into intern mode
  // and defines the study scope — each video source the student owns, each
  // with its own subject list (multiple sources allowed). Allocation walks
  // VideoCatalogItem in sheetRow order across the combined slice. While
  // isIntern is false the scope is ignored (and kept, so a re-toggle restores
  // the previous selection).
  isIntern: {
    type: Boolean,
    default: false
  },
  internScope: [{
    source: { type: String, required: true, trim: true }, // catalog display spelling
    sourceKey: { type: String, required: true, trim: true }, // normalized match key
    subjects: [{ type: String, required: true, trim: true }] // catalog subject spellings
  }]
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