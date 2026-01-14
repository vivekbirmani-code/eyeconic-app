const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    userName: {
        type: String
    },
    joinedAt: {
        type: Date,
        default: Date.now
    },
    leftAt: {
        type: Date
    },
    isMuted: {
        type: Boolean,
        default: false
    }
}, { _id: false });

const callSchema = new mongoose.Schema({
    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
        required: true
    },
    initiator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    participants: [participantSchema],
    status: {
        type: String,
        enum: ['active', 'ended'],
        default: 'active'
    },
    startTime: {
        type: Date,
        default: Date.now
    },
    endTime: {
        type: Date
    }
}, {
    timestamps: true
});

// Index for finding active calls in a group
callSchema.index({ groupId: 1, status: 1 });

module.exports = mongoose.model('Call', callSchema);
