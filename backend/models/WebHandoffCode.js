const mongoose = require('mongoose');

/**
 * One-time handoff codes that let a signed-in mobile-app user open the
 * Eyeconic marketing website (eyeconicneetpg.com) already authenticated.
 *
 * Flow (see backend/routes/auth.js POST /web-handoff and
 * backend/routes/integration.js POST /handoff/consume):
 *   1. The app requests a code with the user's JWT.
 *   2. Only a SHA-256 hash of the code is stored here (TTL 2 minutes).
 *   3. The app opens  https://<website>/app-link?code=...&dest=...
 *   4. The website's server consumes the code server-to-server
 *      (service-authenticated) and receives a fresh user JWT in exchange.
 *
 * The raw code never touches this collection, is single-use, and expires
 * quickly, so a leaked URL cannot be replayed and carries no credentials.
 */
const WebHandoffCodeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // SHA-256 hex digest of the base64url code — never the code itself.
    codeHash: {
      type: String,
      required: true,
      unique: true,
    },
    // Website-relative destination requested by the app (validated there
    // too); kept for auditing only.
    dest: {
      type: String,
      maxlength: 200,
      default: '',
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Expired and consumed codes are garbage-collected by MongoDB shortly after
// expiresAt (single-use is still enforced atomically in the route).
WebHandoffCodeSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

module.exports = mongoose.model('WebHandoffCode', WebHandoffCodeSchema);
