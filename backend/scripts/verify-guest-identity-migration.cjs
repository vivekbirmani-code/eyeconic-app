/**
 * Verification of the guest-identity boot migration (server.js
 * migrateGuestIdentityIndexes): simulates a LEGACY production database
 * (phone-keyed unique index, non-unique email index, duplicate-email leads
 * with attempts), boots the real server, and asserts the migration merged
 * leads, re-pointed attempts, and swapped indexes correctly.
 *
 * Run from backend/:  node scripts/verify-guest-identity-migration.cjs
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'migration-verify-secret';
process.env.PORT = '3198';

const path = require('path');
const http = require('http');
const { MongoClient } = require('mongodb');

const BACKEND = path.resolve(__dirname, '..');
const requireB = (p) => require(path.join(BACKEND, p));
const log = (...a) => console.log('[mig-verify]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { MongoMemoryServer } = requireB('node_modules/mongodb-memory-server');
  const mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  process.env.MONGODB_URI = uri; // pinned BEFORE server require

  // --- 1. Create the LEGACY database shape via the raw driver ---
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const { ObjectId } = require('mongodb');
  const quizA = new ObjectId();
  const quizB = new ObjectId();
  const guests = [
    // Duplicate-email pair (pre-email-keying data): same email, two phones,
    // each having taken a different quiz.
    { _id: undefined, name: 'Rahul Sharma', email: 'rahul.sharma@example.com', phone: '+919876543210', quizzesTaken: [quizA], marketingConsent: { granted: false, updatedAt: new Date() }, createdAt: new Date('2026-08-01'), updatedAt: new Date('2026-08-01') },
    { name: 'Rahul S.', email: 'rahul.sharma@example.com', phone: '+919811111111', quizzesTaken: [quizB], marketingConsent: { granted: true, updatedAt: new Date('2026-09-01') }, createdAt: new Date('2026-08-15'), updatedAt: new Date('2026-08-15') },
    // Normal lead.
    { name: 'Amit Kumar', email: 'amit.kumar@example.com', phone: '+919822222222', quizzesTaken: [], marketingConsent: { granted: false, updatedAt: new Date() }, createdAt: new Date('2026-08-02'), updatedAt: new Date('2026-08-02') },
  ];
  const inserted = await db.collection('guests').insertMany(guests.map((g) => ({ ...g })));
  const ids = inserted.insertedIds;

  // Legacy indexes: unique phone, plain email.
  await db.collection('guests').createIndex({ phone: 1 }, { unique: true, name: 'phone_1' });
  await db.collection('guests').createIndex({ email: 1 }, { name: 'email_1' });

  // An attempt referencing the NEWER dupe (must be re-pointed to the keeper).
  await db.collection('guestattempts').insertOne({
    quiz: null, guestId: 'legacy-device', guest: ids[1],
    guestName: 'Rahul S.', guestEmail: 'rahul.sharma@example.com', guestPhone: '+919811111111',
    status: 'completed', answers: [], createdAt: new Date(), updatedAt: new Date(),
  });
  await client.close();
  log('legacy database seeded (phone_1 unique, email_1 plain, duplicate-email lead pair)');

  // --- 2. Boot the real server (runs the migration on connect) ---
  const mailer = requireB('utils/mailer');
  mailer.sendGuestQuizOtpMail = async () => {};
  const { server } = requireB('server');
  await new Promise((r) => server.listen(process.env.PORT, r));
  await sleep(6000); // allow connect + migration + index builds to settle

  // --- 3. Assert the migration outcome ---
  const assert = require('assert');
  const mongoose = requireB('node_modules/mongoose');
  const GuestAttempt = requireB('models/GuestAttempt');
  const Guest = requireB('models/Guest');

  const merged = await Guest.find({ email: 'rahul.sharma@example.com' });
  assert.strictEqual(merged.length, 1, 'duplicate-email leads merged into one');
  const keeper = merged[0];
  assert.strictEqual(String(keeper._id), String(ids[0]), 'oldest lead kept');
  assert.strictEqual(keeper.marketingConsent.granted, true, 'consent merged (any granted wins)');
  // quizzesTaken merged from both dupes, still ObjectIds (not stringified).
  const takenIds = (keeper.quizzesTaken || []).map(String).sort();
  assert.deepStrictEqual(takenIds, [String(quizA), String(quizB)].sort(), 'quizzesTaken merged from both dupes');
  const rawKeeper = await mongoose.connection.collection('guests').findOne({ _id: keeper._id });
  assert.ok(
    rawKeeper.quizzesTaken.every((id) => id instanceof ObjectId),
    'quizzesTaken entries remain ObjectIds'
  );

  const attempt = await GuestAttempt.findOne({ guestId: 'legacy-device' });
  assert.strictEqual(String(attempt.guest), String(keeper._id), 'attempt re-pointed to the keeper lead');

  const col = mongoose.connection.collection('guests');
  const indexNames = (await col.indexes()).map((i) => i.name);
  assert.ok(!indexNames.includes('phone_1'), `legacy phone_1 dropped (have: ${indexNames})`);
  assert.ok(!indexNames.includes('email_1'), `legacy email_1 dropped (have: ${indexNames})`);
  assert.ok(indexNames.includes('guest_email_unique_1'), 'unique email index built');
  assert.ok(indexNames.includes('guest_phone_lookup_1'), 'phone lookup index built');

  // Uniqueness enforced: a second doc with the same email is rejected.
  let dupRejected = false;
  try {
    await col.insertOne({ name: 'Dup', email: 'amit.kumar@example.com', phone: '+919333333333', createdAt: new Date() });
  } catch (e) {
    dupRejected = e.code === 11000;
  }
  assert.ok(dupRejected, 'duplicate email insert rejected (E11000)');

  log('ALL MIGRATION ASSERTIONS PASSED — merged leads, re-pointed attempts, swapped indexes, uniqueness enforced');

  server.close();
  await mongoose.disconnect();
  await mongoServer.stop();
  process.exit(0);
})().catch((err) => {
  console.error('migration verify FAILED:', err.message);
  process.exit(1);
});
