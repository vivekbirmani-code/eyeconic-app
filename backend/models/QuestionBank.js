const mongoose = require('mongoose');

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
    chapter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chapter'
    },
    topic: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Topic'
    },
    topicName: {
        type: String, // Store topic name directly for Excel imports
        trim: true
    },
    question: {
        type: String,
        required: true,
        trim: true
    },
    questionImage: {
        type: String // URL or file path
    },
    options: [{
        type: String,
        required: true
    }],
    optionImages: [{
        type: String // Array of URLs corresponding to options
    }],
    correctAnswer: {
        type: Number,
        required: true,
        min: 0,
        max: 3
    },
    explanation: {
        type: String,
        default: ''
    },
    explanationImage: {
        type: String // URL or file path
    },
    marks: {
        type: Number,
        default: 1
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard'],
        default: 'medium'
    },
    tags: [{
        type: String
    }],
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

// Indexes for efficient queries
questionBankSchema.index({ subject: 1, topic: 1 });
questionBankSchema.index({ subject: 1, isActive: 1 });
questionBankSchema.index({ qid: 1 });
questionBankSchema.index({ topicName: 1 });

module.exports = mongoose.model('QuestionBank', questionBankSchema);
