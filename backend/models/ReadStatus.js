const mongoose = require('mongoose');

const readStatusSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    lastReadAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound index for fast lookup of a user's read status in a specific group
readStatusSchema.index({ userId: 1, groupId: 1 }, { unique: true });

module.exports = mongoose.model('ReadStatus', readStatusSchema);
