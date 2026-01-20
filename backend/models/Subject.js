const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    year: {
        type: String,
        enum: ['1st', '2nd', '3rd', '4th'],
        required: true
    },
    displayOrder: {
        type: Number,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for faster queries
subjectSchema.index({ year: 1, displayOrder: 1 });

module.exports = mongoose.model('Subject', subjectSchema);
