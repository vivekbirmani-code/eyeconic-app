/**
 * Per-image outcome tracking for Excel question imports.
 *
 * Both import paths (question-bank bulk import and quiz import-excel) run
 * their rows through the canonical image pipelines in imageUploader.js; this
 * module is the single counting mechanism behind the app's "Image Upload
 * Summary" popup. Images are tracked individually — one row can carry both a
 * question image and a solution image — keyed by the sheet row number so a
 * failure can point the admin back at the exact row in Excel.
 *
 * Contract:
 *   expect(rowNumber, type)  — an image cell detected in the uploaded file
 *                              (counts toward total).
 *   markUploaded(...)        — the image ended up stored and linked.
 *   markFailed(...)          — extraction/transfer/upload/association failed.
 *   markSkipped(...)         — detected but not processed: the row was a
 *                              duplicate, so the existing question (with its
 *                              own stored images) was reused as-is.
 *   failRow(rowNumber, why)  — the row's question was not saved, so none of
 *                              its images ended up linked to a question.
 *
 * An entry that is still `pending` at toJSON() time needed no upload (the
 * value was already on our Cloudinary CDN or an inline data URI), so it is
 * reported as uploaded — the image IS stored and linked as-is.
 */

const IMAGE_TYPES = Object.freeze({
    QUESTION: 'question',
    SOLUTION: 'solution',
});

const createImageImportSummary = () => {
    // `${rowNumber}|${type}` → { status: 'pending' | 'uploaded' | 'failed', reason? }
    const entries = new Map();

    const key = (rowNumber, type) => `${rowNumber}|${type}`;

    const mark = (rowNumber, type, status, reason) => {
        if (!rowNumber || !type) return;
        entries.set(key(rowNumber, type), reason ? { status, reason } : { status });
    };

    return {
        expect(rowNumber, type) {
            if (!rowNumber || !type) return;
            const k = key(rowNumber, type);
            // The composite key dedupes: a question image and a solution
            // image are two entries, but re-registering the same slot must
            // never inflate the total.
            if (!entries.has(k)) entries.set(k, { status: 'pending' });
        },

        markUploaded(rowNumber, type) {
            mark(rowNumber, type, 'uploaded');
        },

        markFailed(rowNumber, type, reason) {
            mark(rowNumber, type, 'failed', reason);
        },

        markSkipped(rowNumber, type) {
            mark(rowNumber, type, 'skipped');
        },

        failRow(rowNumber, reason) {
            if (!rowNumber) return;
            const prefix = `${rowNumber}|`;
            entries.forEach((entry, k) => {
                if (k.startsWith(prefix) && entry.status !== 'failed') {
                    entries.set(k, { status: 'failed', reason });
                }
            });
        },

        toJSON() {
            const failures = [];
            let skipped = 0;
            entries.forEach((entry, k) => {
                if (entry.status === 'skipped') {
                    skipped++;
                    return;
                }
                if (entry.status !== 'failed') return;
                const [rowRaw, type] = k.split('|');
                failures.push({
                    row: Number(rowRaw),
                    type,
                    reason: entry.reason,
                });
            });
            // Sheet order keeps the popup list matching the Excel file top to
            // bottom; the type tiebreak is just deterministic.
            failures.sort((a, b) => a.row - b.row || a.type.localeCompare(b.type));
            return {
                total: entries.size,
                uploaded: entries.size - failures.length - skipped,
                failed: failures.length,
                skipped,
                failures,
            };
        },
    };
};

module.exports = {
    IMAGE_TYPES,
    createImageImportSummary,
};
