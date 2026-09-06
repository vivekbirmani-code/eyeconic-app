/**
 * One-time repair: replace a question whose image is the "Image being
 * updated" placeholder with REAL content from an imported question.
 *
 * Background: the image_based sample row of the import template reached
 * production quizzes carrying a dead example.com URL; the Sep-6 repair
 * swapped it for a generated placeholder SVG ("Image being updated…") so
 * guests would not see a broken-image icon. The real bank has since been
 * imported — this script turns that sample question into the real
 * image-based question every public quiz actually references, so
 * participants see the real diagram, options, answer and explanation.
 *
 * Safety:
 *   - Dry run by default; --apply writes.
 *   - Refuses to touch the target unless its questionImage is the known
 *     placeholder asset (or --force), so a rerun / wrong id can never
 *     overwrite real content.
 *
 * Usage:
 *   node scripts/syncImageQuestion.js --target <questionId> --from-qid <qid> [--apply] [--force]
 */
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const argValue = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
};

const apply = args.includes('--apply');
const force = args.includes('--force');
const targetId = argValue('--target');
const fromQid = argValue('--from-qid');

const PLACEHOLDER_MARKER = 'question-image-placeholder';

(async () => {
    if (!targetId || !fromQid) {
        console.error('Usage: node scripts/syncImageQuestion.js --target <questionId> --from-qid <qid> [--apply] [--force]');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    const QuestionBank = require('../models/QuestionBank');

    const target = await QuestionBank.findById(targetId);
    if (!target) throw new Error(`Target question ${targetId} not found.`);
    if (!force && !(target.questionImage || '').includes(PLACEHOLDER_MARKER)) {
        throw new Error(
            `Refusing: target ${targetId} questionImage is not the placeholder asset.\n` +
            `  got: ${target.questionImage}\n` +
            `  Re-run with --force only if you really intend to overwrite it.`
        );
    }

    const source = await QuestionBank.findOne({ qid: fromQid });
    if (!source) throw new Error(`Source question with qid "${fromQid}" not found.`);
    if (!(source.questionImage || '').includes('res.cloudinary.com')) {
        throw new Error(`Refusing: source qid ${fromQid} has no Cloudinary image (${source.questionImage}).`);
    }

    const fields = [
        'subject', 'topicName', 'subtopicName', 'system', 'questionType', 'tags', 'difficulty',
        'question', 'questionImage', 'options', 'optionImages', 'assertion', 'reason',
        'columnA', 'columnB', 'correctAnswer', 'explanation', 'explanationImage', 'marrowCode', 'source',
    ];

    console.log(`\n${apply ? 'APPLYING' : 'DRY RUN'} — target ${targetId} <- source qid ${fromQid} (${source._id})`);
    fields.forEach((f) => {
        const before = JSON.stringify(target[f]);
        const after = JSON.stringify(source[f]);
        if (before !== after) console.log(`  ${f}: ${before?.slice(0, 90)}  ->  ${after?.slice(0, 90)}`);
    });

    if (!apply) {
        console.log('\nDry run only — re-run with --apply to write.');
    } else {
        fields.forEach((f) => { target[f] = source[f]; });
        await target.save();
        console.log(`\nSaved. Target ${targetId} now carries the real question + Cloudinary image.`);
    }

    await mongoose.disconnect();
})().catch((err) => {
    console.error('Repair failed:', err.message);
    process.exit(1);
});
