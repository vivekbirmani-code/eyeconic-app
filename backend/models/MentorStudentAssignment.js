const mongoose = require('mongoose');

const mentorStudentAssignmentSchema = new mongoose.Schema({
    mentor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    student: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    assignedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Ensure unique mentor-student pairs
mentorStudentAssignmentSchema.index({ mentor: 1, student: 1 }, { unique: true });

module.exports = mongoose.model('MentorStudentAssignment', mentorStudentAssignmentSchema);
