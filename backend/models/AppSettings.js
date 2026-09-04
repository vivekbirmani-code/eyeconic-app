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
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('AppSettings', appSettingsSchema);
