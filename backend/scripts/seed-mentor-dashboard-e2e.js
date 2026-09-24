/**
 * Local-dev E2E seed for Feature 08 (run once, manually): ensures a mentor
 * and a free user exist with known passwords so the website dashboard flow
 * can be driven end-to-end. Never used in production or tests.
 *
 * Usage: node scripts/seed-mentor-dashboard-e2e.js
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('dotenv').config();

const mongoose = require('mongoose');
const User = require('../models/User');
const { getMongoUri } = require('../utils/mongoUri');

const MENTOR_EMAIL = 'dev-mentor-e2e@example.com';
const FREE_EMAIL = 'dev-free-e2e@example.com';
const PASSWORD = 'DashboardE2E!2026';

(async () => {
  await mongoose.connect(getMongoUri());

  const mentor = await User.findOneAndUpdate(
    { email: MENTOR_EMAIL },
    { $setOnInsert: { name: 'Dev Mentor', role: 'mentor', isFreeUser: false } },
    { upsert: true, new: true }
  );
  mentor.password = PASSWORD;
  await mentor.save();


  const freeUser = await User.findOneAndUpdate(
    { email: FREE_EMAIL },
    {
      $setOnInsert: {
        name: 'Dev Free User',
        role: 'student',
        isFreeUser: true,
        freeUserProfile: { year: 'Intern', issues: 'Revision plan', resources: ['Marrow', 'PrepLadder'], isReadyToTransform: true },
        isProfileComplete: true,
      },
    },
    { upsert: true, new: true }
  );
  // Upserts don't run the hashing hook — set the password through save().
  freeUser.password = PASSWORD;
  await freeUser.save();

  console.log(`mentor: ${MENTOR_EMAIL} (${mentor._id})`);
  console.log(`free user: ${FREE_EMAIL} (${freeUser._id})`);
  console.log(`password (both): ${PASSWORD}`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
