const mongoose = require('mongoose');

const messageReadStatusSchema = new mongoose.Schema({
    messageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    readAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Compound index for fast lookup
messageReadStatusSchema.index({ messageId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('MessageReadStatus', messageReadStatusSchema);
