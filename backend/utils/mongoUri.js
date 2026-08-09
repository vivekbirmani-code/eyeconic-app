/**
 * Returns MONGODB_URI from environment. Throws if not configured.
 */
function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri || !uri.trim()) {
    throw new Error(
      'MONGODB_URI is not set. Add it to backend/.env (see .env.example).'
    );
  }
  return uri.trim();
}

module.exports = { getMongoUri };
