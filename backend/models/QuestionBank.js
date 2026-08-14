const mongoose = require('mongoose');
const { QUESTION_TYPES, QUESTION_TYPE_VALUES, DIFFICULTY_VALUES } = require('../constants/question');

const questionBankSchema = new mongoose.Schema({
    qid: {
        type: String,
        unique: true,
        sparse: true // Allows multiple null values
    },
    subject: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subject',
        required: true
    },
    // Legacy relational refs. Unused by the production write path (topicName
    // string is canonical) but left in place for backward compatibility.
    chapter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chapter'
    },
    topic: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Topic'
    },

    // ---- Canonical classification (seven required/optional parameters) ----
    topicName: {
        type: String,
        trim: true,
        required: [true, 'Topic is required']
    },
    subtopicName: {
        type: String,
        trim: true,
        required: [true, 'Subtopic is required']
    },
    system: {
        type: String,
        trim: true,
        required: [true, 'System is required']
    },
    questionType: {
        type: String,
        enum: {
            values: QUESTION_TYPE_VALUES,
            message: 'Invalid question type: {VALUE}'
        },
        required: [true, 'Question type is required']
    },
    tags: {
        type: [String],
        default: []
    },
    difficulty: {
        type: String,
        enum: {
            values: DIFFICULTY_VALUES,
            message: 'Invalid difficulty: {VALUE}'
        },
        required: [true, 'Difficulty is required']
    },

    // ---- Question content ----
    question: {
        type: String,
        required: true,
        trim: true
    },
    questionImage: {
        type: String // URL or file path
    },

    // Used by: mcq_single, image_based, assertion_reason, multiple_correct
    options: {
        type: [String],
        default: undefined
    },
    optionImages: {
        type: [String],
        default: undefined
    },

    // Used by: assertion_reason
    assertion: {
        type: String,
        trim: true
    },
    reason: {
        type: String,
        trim: true
    },

    // Used by: match_the_following
    columnA: {
        type: [String],
        default: undefined
    },
    columnB: {
        type: [String],
        default: undefined
    },

    // Canonical answer key. Shape depends on questionType:
    //   mcq_single / image_based / assertion_reason -> Number (option index)
    //   multiple_correct                            -> Number[] (option indices)
    //   match_the_following                         -> Object map { "0": "2", ... } (columnA idx -> columnB idx)
    //   numerical                                    -> Number
    correctAnswer: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },

    explanation: {
        type: String,
        default: ''
    },
    explanationImage: {
        type: String // URL or file path
    },

    marrowCode: {
        type: String
    },
    source: {
        type: String
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Indexes for efficient queries — chosen based on actual filter/query patterns
// used by the question bank list, quiz builder, and analytics, not one per field.
questionBankSchema.index({ subject: 1, topic: 1 });
questionBankSchema.index({ subject: 1, isActive: 1 });
questionBankSchema.index({ subject: 1, topicName: 1, isActive: 1 });
questionBankSchema.index({ qid: 1 });
questionBankSchema.index({ topicName: 1 });
questionBankSchema.index({ subtopicName: 1, isActive: 1 });
questionBankSchema.index({ system: 1, isActive: 1 });
questionBankSchema.index({ questionType: 1, isActive: 1 });
questionBankSchema.index({ difficulty: 1, isActive: 1 });
questionBankSchema.index({ tags: 1 });

module.exports = mongoose.model('QuestionBank', questionBankSchema);
module.exports.QUESTION_TYPES = QUESTION_TYPES;
