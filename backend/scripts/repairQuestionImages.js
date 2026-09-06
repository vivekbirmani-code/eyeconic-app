/**
 * One-time repair for question images that can never load.
 *
 * Problem this fixes: Excel imports stored Q_IMAGE / O_IMAGE / SOLUTION_IMAGE
 * values verbatim. The import template's sample row ships placeholder URLs
 * (https://example.com/...), and importing it as-is pushed those dead URLs
 * into the live question bank — every participant then sees a broken image.
 * (Validation added in utils/questionValidation.js now rejects these at write
 * time; this script cleans up what already got in.)
 *
 * What it does:
 *   - Finds questions whose questionImage / optionImages / explanationImage
 *     point at a known placeholder host (example.com and friends).
 *   - image_based questions REQUIRE an image, so theirs is replaced with a
 *     generated placeholder uploaded to Cloudinary (eyeconic_questions/).
 *     Admins should still swap in the real anatomical image via the
 *     Question Bank editor.
 *   - Non-required placeholder references (option images, explanation
 *     images, question images on non-image_based questions) are cleared.
 *   - Idempotent: a second run finds nothing to change.
 *   - Never touches non-placeholder URLs, even unreachable ones (a dead
 *     host may be transient) — those are only reported as warnings.
 *
 * Usage:
 *   node scripts/repairQuestionImages.js            # dry run (default)
 *   node scripts/repairQuestionImages.js --apply    # write changes
 */

const path = require('path');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

// Load backend/.env (MONGODB_URI, CLOUDINARY_*) regardless of cwd
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PLACEHOLDER_HOSTS = new Set([
    'example.com',
    'www.example.com',
    'example.org',
    'www.example.org',
    'example.net',
    'www.example.net',
]);

const isPlaceholderUrl = (value) => {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        return PLACEHOLDER_HOSTS.has(new URL(value.trim()).hostname.toLowerCase());
    } catch {
        return false;
    }
};

// Neutral stand-in so image_based questions (which must have an image) never
// render a browser broken-image icon. Rendered as SVG — browsers draw the
// text with system fonts when the file is used in an <img> tag.
const PLACEHOLDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
  <rect width="800" height="500" fill="#F8FAFC"/>
  <rect x="24" y="24" width="752" height="452" rx="16" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="3" stroke-dasharray="12 8"/>
  <g fill="none" stroke="#94A3B8" stroke-width="10" stroke-linecap="round">
    <rect x="330" y="120" width="140" height="100" rx="14"/>
    <circle cx="365" cy="160" r="14"/>
    <path d="M345 212 L375 182 M392 212 L455 149 M425 212 L465 172"/>
  </g>
  <text x="400" y="290" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#475569">Image being updated</text>
  <text x="400" y="330" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="19" fill="#64748B">This question will show its diagram once the image is replaced.</text>
  <text x="400" y="404" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#94A3B8">Eyeconic Mentors</text>
</svg>`;

async function uploadPlaceholder() {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    const result = await cloudinary.uploader.upload(
        `data:image/svg+xml;base64,${Buffer.from(PLACEHOLDER_SVG).toString('base64')}`,
        { folder: 'eyeconic_questions', resource_type: 'image', public_id: 'question-image-placeholder' }
    );
    return result.secure_url;
}

(async () => {
    const apply = process.argv.includes('--apply');
    await mongoose.connect(process.env.MONGODB_URI);
    const QuestionBank = mongoose.connection.collection('questionbanks');

    // Reuse one uploaded placeholder for every question that needs one.
    let placeholderUrl = null;
    const getPlaceholderUrl = async () => {
        if (!placeholderUrl) placeholderUrl = await uploadPlaceholder();
        return placeholderUrl;
    };

    const cursor = QuestionBank.find({});
    let scanned = 0;
    let changed = 0;
    const warnings = [];

    for await (const q of cursor) {
        scanned++;
        const updates = {};

        const qImg = q.questionImage;
        if (isPlaceholderUrl(qImg)) {
            if (q.questionType === 'image_based') {
                // Only resolve (and upload) the placeholder when applying —
                // a dry run must have no side effects.
                updates.questionImage = apply ? await getPlaceholderUrl() : '(Cloudinary placeholder)';
            } else {
                updates.questionImage = null;
            }
        } else if (typeof qImg === 'string' && /^https?:\/\//i.test(qImg)) {
            warnings.push(`${q._id}: questionImage host not placeholder — left untouched (${qImg})`);
        }

        if (Array.isArray(q.optionImages)) {
            const cleaned = q.optionImages.map((img) => (isPlaceholderUrl(img) ? '' : img));
            if (cleaned.some((img, i) => img !== q.optionImages[i])) {
                updates.optionImages = cleaned;
            }
        }

        if (isPlaceholderUrl(q.explanationImage)) {
            updates.explanationImage = null;
        }

        if (Object.keys(updates).length === 0) continue;

        changed++;
        const summary = Object.entries(updates)
            .map(([k, v]) => (k === 'questionImage' && v ? `${k} -> Cloudinary placeholder` : `${k} -> ${v === null ? 'cleared' : JSON.stringify(v)}`))
            .join(', ');
        console.log(`${apply ? 'FIXING' : 'DRY RUN'}  ${q._id} (${q.questionType}): ${summary}`);

        if (apply) {
            await QuestionBank.updateOne({ _id: q._id }, { $set: updates });
        }
    }

    console.log(`\nScanned ${scanned} questions — ${changed} need repair${apply ? ' (applied)' : ' (dry run, re-run with --apply)'}.`);
    if (placeholderUrl) console.log(`Placeholder image: ${placeholderUrl}`);
    warnings.forEach((w) => console.log(`WARNING  ${w}`));

    await mongoose.disconnect();
    process.exit(0);
})().catch((err) => {
    console.error('Repair failed:', err.message);
    process.exit(1);
});
