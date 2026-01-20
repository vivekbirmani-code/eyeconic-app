const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    subject: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subject',
        required: true
    },
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    mentor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    taskType: {
        type: String,
        enum: ['Main Video', 'Revision 1 (R1)', 'Revision 2 (R2)', 'Revision 3 (R3)', 'Custom Mobile Mixed Bag', 'Myonebook Review', 'Other'],
        required: true
    },
    duration: {
        type: Number, // Duration in minutes
        required: true
    },
    scheduledDate: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'verified', 'redo'],
        default: 'pending'
    },
    completedAt: {
        type: Date
    },
    verifiedAt: {
        type: Date
    },
    mentorComment: {
        type: String,
        trim: true
    },
    // For tracking redo requests
    redoRequestedAt: {
        type: Date
    },
    redoReason: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

// Indexes for faster queries
assignmentSchema.index({ student: 1, scheduledDate: -1 });
assignmentSchema.index({ mentor: 1, scheduledDate: -1 });
assignmentSchema.index({ status: 1 });

module.exports = mongoose.model('Assignment', assignmentSchema);
