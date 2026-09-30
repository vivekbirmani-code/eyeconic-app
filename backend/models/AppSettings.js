const mongoose = require('mongoose');

/**
 * Singleton document holding app-wide, admin-controlled settings.
 * There is exactly one row (singleton: true); access it through
 * utils/appSettings.getAppSettings() so callers never create duplicates.
 */
const appSettingsSchema = new mongoose.Schema({
  singleton: {
    type: Boolean,
    default: true,
    required: true,
    unique: true,
  },
  // When false, the public Sign Up option is removed from the app and all
  // account-creating auth endpoints reject new registrations. Defaults to
  // false so new environments are closed until an admin opens them.
  signUpEnabled: {
    type: Boolean,
    default: false,
  },
  // AI proctoring global kill switch (plan §21.3/§31). Rollout precedence:
  // this switch > aiProctoring feature flag > per-quiz proctoring config.
  // Defaults to false and fails closed — new environments (and DB errors)
  // read as "proctoring off", so no quiz is ever proctored without explicit
  // admin action on all three gates.
  proctoringEnabled: {
    type: Boolean,
    default: false,
  },
  // Restricted strict-CV enforcement gate (decision D8): allowing
  // probabilistic CV events to auto-submit. NOT a per-quiz setting; stays
  // false for the entire V1 rollout. Fails closed like the kill switch.
  proctoringStrictCv: {
    type: Boolean,
    default: false,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('AppSettings', appSettingsSchema);
