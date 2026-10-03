/**
 * One-off retitle for the Mini CCT → Mini GT rename (run once, manually):
 * rewrites the stored brand name on existing Mini GT quizzes —
 *
 *  - title:        "Mini CCT #1" → "Mini GT #1"
 *  - instructions: "This Mini CCT has 30 questions…" → "This Mini GT has…"
 *
 * Idempotent: a second run finds nothing to change. Dry-run by default;
 * pass --apply to write.
 *
 * Usage: node scripts/retitle-mini-gt.js [--apply]
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
require('dotenv').config();

const mongoose = require('mongoose');
const Quiz = require('../models/Quiz');
const { getMongoUri } = require('../utils/mongoUri');

const apply = process.argv.includes('--apply');
const retitle = (text) => (typeof text === 'string' ? text.replace(/Mini CCT/g, 'Mini GT') : text);

(async () => {
  await mongoose.connect(getMongoUri());
  const quizzes = await Quiz.find({ testType: 'mini' });
  let changed = 0;

  for (const quiz of quizzes) {
    const title = retitle(quiz.title);
    const instructions = Array.isArray(quiz.instructions)
      ? quiz.instructions.map(retitle)
      : quiz.instructions;

    const titleChanged = title !== quiz.title;
    const instructionsChanged =
      Array.isArray(instructions) &&
      Array.isArray(quiz.instructions) &&
      instructions.some((line, i) => line !== quiz.instructions[i]);

    if (!titleChanged && !instructionsChanged) continue;
    changed += 1;

    if (apply) {
      await Quiz.updateOne(
        { _id: quiz._id },
        { ...(titleChanged ? { title } : {}), ...(instructionsChanged ? { instructions } : {}) }
      );
      console.log(`retitled  ${quiz.title} → ${title}`);
    } else {
      console.log(`would rename  "${quiz.title}" → "${title}"${instructionsChanged ? ' (+ instructions)' : ''}`);
    }
  }

  console.log(apply ? `Done: retitled ${changed} quiz(es).` : `Dry run: ${changed} quiz(es) would change. Re-run with --apply to write.`);
  await mongoose.disconnect();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
