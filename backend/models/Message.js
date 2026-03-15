const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  content: {
    type: String,
    trim: true,
    default: ''
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    required: true
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'file', 'call_start', 'call_end', 'call_missed'],
    default: 'text'
  },
  callId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Call'
  },
  callDurationSeconds: {
    type: Number,
    default: 0
  },
  attachments: [{
    type: {
      type: String,
      enum: ['image', 'video', 'document'],
      required: true
    },
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    name: String,
    size: Number,
    mimeType: String
  }],
  // Message status tracking
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  // Edit tracking
  isEdited: {
    type: Boolean,
    default: false
  },
  editedAt: {
    type: Date
  },
  // Delete tracking
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedForEveryone: {
    type: Boolean,
    default: false
  },
  deletedFor: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Message', messageSchema);
