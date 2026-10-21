const mongoose = require('mongoose');

const {
  ATTENTION_MODES,
  DEFAULT_RISK_WEIGHTS,
} = require('../utils/proctoring/defaults');

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
    enum: ['daily', 'weekly', 'grand', 'mini'],
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
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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
  // Section locking: students proceed section-by-section; a section locks
  // permanently for an attempt once submitted (explicitly or by timer expiry).
  // Missing field on legacy quizzes is treated as ON — always read via
  // `quiz.lockSectionsAfterSubmission !== false`, never truthiness.
  lockSectionsAfterSubmission: {
    type: Boolean,
    default: true
  },
  assignToAllFreeUsers: {
    type: Boolean,
    default: false
  },
  // Proctoring configuration (plan §21.2) — STRICTLY OPT-IN: `enabled`
  // defaults to false and an absent subdoc can never enable proctoring
  // (decision D15; unlike lockSectionsAfterSubmission there is deliberately
  // no missing-means-on trap here). Authoring payloads are validated by
  // utils/proctoring/policySnapshot.js#parseProctoringConfig before they
  // reach this schema. The EFFECTIVE policy is frozen onto the attempt at
  // /start (attempt.proctoringSnapshot) — later edits never affect in-flight
  // attempts.
  proctoring: {
    enabled: {
      type: Boolean,
      default: false
    },
    camera: {
      type: String,
      enum: ['required', 'optional'],
      default: 'required'
    },
    focusEvents: {
      mode: {
        type: String,
        enum: ['record', 'warn-only', 'warn-then-submit'],
        default: 'warn-then-submit'
      },
      toleratedViolations: {
        type: Number,
        default: 3,
        min: 1,
        max: 10
      },
      minDurationMs: {
        type: Number,
        default: 2000
      },
      prolongedAbsenceMs: {
        type: Number,
        default: 60000
      }
    },
    multipleFaces: {
      mode: {
        type: String,
        enum: ['record', 'warn'],
        default: 'warn'
      },
      minDurationMs: {
        type: Number,
        default: 3000
      }
    },
    facePresence: {
      mode: {
        type: String,
        enum: ['record', 'warn'],
        default: 'warn'
      },
      minAbsentMs: {
        type: Number,
        default: 8000
      }
    },
    attention: {
      enabled: {
        type: Boolean,
        default: true
      },
      // D6 + Phase 9.1: default 'record' (attention can never act beyond an
      // advisory banner); 'warn' is the explicit per-quiz opt-in that shows a
      // warn banner on the 3rd-occurrence marker. No submit-flavored value
      // exists — attention can never cost the student their attempt.
      mode: {
        type: String,
        enum: ATTENTION_MODES,
        default: 'record'
      },
      // Phase 5 SHAPING thresholds (plan §13.2): when a record-only
      // observation episode opens — never a consequence (D6). No mongoose
      // defaults here on purpose: only values parseProctoringConfig accepted
      // are stored; the effective-policy merge fills the documented defaults.
      thresholds: {
        turnedDeg: { type: Number, min: 1, max: 90 },
        extreme: {
          yawDeg: { type: Number, min: 1, max: 90 },
          pitchDeg: { type: Number, min: 1, max: 90 },
          sustainMs: { type: Number, min: 0, max: 60 * 60 * 1000 }
        },
        repeatedHeadPose: {
          minEpisodes: { type: Number, min: 2, max: 50 },
          minEpisodeMs: { type: Number, min: 0, max: 60 * 60 * 1000 },
          windowMs: { type: Number, min: 1000, max: 24 * 60 * 60 * 1000 }
        },
        deviation: {
          deg: { type: Number, min: 1, max: 90 },
          sustainMs: { type: Number, min: 0, max: 60 * 60 * 1000 }
        },
        repeatedDeviation: {
          minEpisodes: { type: Number, min: 2, max: 50 },
          minEpisodeMs: { type: Number, min: 0, max: 60 * 60 * 1000 },
          windowMs: { type: Number, min: 1000, max: 24 * 60 * 60 * 1000 }
        },
        fallbackPadDeg: { type: Number, min: 1, max: 90 }
      }
    },
    cameraHealth: {
      lossWarnAfterMs: {
        type: Number,
        default: 10000
      },
      lossSubmitAfterMs: {
        type: Number,
        default: 60000
      },
      rejoinAttempts: {
        type: Number,
        default: 3
      }
    },
    sessionHealth: {
      heartbeatIntervalMs: {
        type: Number,
        default: 30000
      },
      timeoutMs: {
        type: Number,
        default: 90000
      },
      onProlongedOutage: {
        type: String,
        enum: ['record', 'warn', 'submit'],
        default: 'record'
      }
    },
    screenCapturePrevention: {
      enabled: {
        type: Boolean,
        default: true
      }
    },
    maxViolations: {
      type: Number,
      default: 3,
      min: 1,
      max: 10
    },
    violationAction: {
      type: String,
      enum: ['warn', 'submit'],
      default: 'warn'
    },
    // Platform-controlled provisional weights (§19.2) — authoring payloads
    // cannot set these (parseProctoringConfig rejects them); stored so the
    // frozen policy snapshot is self-contained.
    riskWeights: {
      type: Object,
      default: () => ({ ...DEFAULT_RISK_WEIGHTS })
    }
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