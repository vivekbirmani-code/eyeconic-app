/**
 * Visual-verification harness backend for the responsiveness audit.
 * Boots the real server.js with an in-memory MongoDB on :3199 and seeds an
 * admin user. CORS allows the second Metro web instance on :8090.
 * Run: node boot-harness-3199.js   (from backend/)
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'responsive-audit-verify-secret';
process.env.PORT = '3199';
process.env.ALLOWED_ORIGINS = 'http://localhost:8090,http://127.0.0.1:8090';

const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server-core');

(async () => {
  const mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri('eyeconic');
  console.log('[harness-backend] in-memory mongo on', mongoServer.getUri());

  const User = require('./models/User');
  const mongoose = require('mongoose');
  await mongoose.connect(process.env.MONGODB_URI);
  await User.create({
    name: 'Admin',
    email: 'admin@neet.com',
    password: 'admin123',
    role: 'admin',
    isActive: true,
  });
  await mongoose.disconnect();
  console.log('[harness-backend] admin seeded');

  const { server } = require('./server.js');
  // server.js only listens when run directly (require.main guard) — listen here.
  server.listen(3199, () => {
    console.log('[harness-backend] listening on http://localhost:3199');
  });
})();
