const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const { convertGoogleDriveUrl, isGoogleDriveUrl } = require('./imageUrls');
const { IMAGE_TYPES, optionImageType } = require('./importImageSummary');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload image from URL to Cloudinary, reporting WHERE it failed.
 *
 * The import summary must distinguish two failure classes:
 *   phase 'download' — the source URL is genuinely unavailable (dead link,
 *                      timeout, or serves a non-image): the stored link will
 *                      not render.
 *   phase 'upload'   — the download succeeded but our Cloudinary transfer
 *                      failed: the retained direct URL still loads.
 *
 * @returns {Promise<{url: string|null, phase?: 'download'|'upload', message?: string}>}
 */
const uploadImageFromUrlDetailed = async (imageUrl, folder = 'eyeconic_questions') => {
    if (!imageUrl || typeof imageUrl !== 'string') {
        return { url: null, phase: 'download', message: 'Empty or non-string image URL.' };
    }

    // Only genuine Drive share links are rewritten. convertGoogleDriveUrl
    // matches any URL containing a 25+ char token, so applying it blindly
    // (as this path used to) corrupted perfectly good non-Drive URLs — e.g.
    // signed CDN links — into dead lh3.googleusercontent.com URLs.
    const url = isGoogleDriveUrl(imageUrl) ? convertGoogleDriveUrl(imageUrl) : imageUrl;
    if (!url) {
        console.log('⚠️ Invalid image URL:', imageUrl);
        return { url: null, phase: 'download', message: 'Invalid image URL.' };
    }

    try {
        console.log(`📥 Downloading image from: ${url.substring(0, 60)}...`);

        // Download image as buffer
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 30000, // 30 second timeout
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        // Check if we got a valid image
        const contentType = response.headers['content-type'];
        if (!contentType || !contentType.startsWith('image/')) {
            console.log(`⚠️ Not an image (${contentType}): ${url.substring(0, 60)}...`);
            return { url: null, phase: 'download', message: `Source returned "${contentType || 'unknown content type'}" — not an image.` };
        }

        // Convert to base64
        const base64 = Buffer.from(response.data).toString('base64');
        const dataUri = `data:${contentType};base64,${base64}`;

        // Upload to Cloudinary
        console.log(`☁️ Uploading to Cloudinary...`);
        try {
            const result = await cloudinary.uploader.upload(dataUri, {
                folder: folder,
                resource_type: 'image'
            });

            console.log(`✅ Uploaded: ${result.secure_url}`);
            return { url: result.secure_url };
        } catch (error) {
            // Bytes were downloaded fine — only the Cloudinary transfer failed,
            // so the direct URL we fall back to is still publicly loadable.
            console.error(`❌ Cloudinary upload failed for ${url.substring(0, 60)}...`);
            console.error(`   Error: ${error.message}`);
            return { url: null, phase: 'upload', message: error.message };
        }
    } catch (error) {
        console.error(`❌ Failed to download image from ${url.substring(0, 60)}...`);
        console.error(`   Error: ${error.message}`);
        return { url: null, phase: 'download', message: error.message };
    }
};

/**
 * Upload image from URL to Cloudinary
 * @param {string} imageUrl - URL of the image to upload
 * @param {string} folder - Cloudinary folder to store image
 * @returns {Promise<string|null>} - Cloudinary secure URL or null if failed
 */
const uploadImageFromUrl = async (imageUrl, folder = 'eyeconic_questions') => {
    const { url } = await uploadImageFromUrlDetailed(imageUrl, folder);
    return url;
};

/**
 * True for values that live on a remote host and are NOT already on our own
 * Cloudinary CDN — i.e. the ones an import should transfer. Inline data:
 * URIs and empty cells need no transfer.
 */
const needsCloudinaryTransfer = (value) => {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('data:')) return false;
    if (!/^https?:\/\//i.test(trimmed)) return false;
    return !trimmed.includes('res.cloudinary.com');
};

/**
 * Transfers every remote image URL on a validated import candidate to our
 * Cloudinary question folder, so what lands in the database is a permanent,
 * publicly deliverable asset on the app's own CDN — the same authoritative
 * image source the admin editor uploads to. Hotlinked third-party URLs
 * (Google Drive etc.) die when sharing is revoked and throttle under load;
 * they must not be the stored source for participant-facing content.
 *
 * A failed transfer NEVER fails the row: the already-normalized direct URL
 * (see imageUrls.convertGoogleDriveUrl) is kept and a warning is returned so
 * the import report surfaces it. Two failure classes stay distinguishable:
 *   - Cloudinary transfer failed → the retained URL still loads, so the row
 *     warns AND the summary marks the image failed (storage did not happen).
 *   - The source URL itself is unavailable (dead link / non-image) → the
 *     retained link is broken; the summary marks the image failed with a
 *     reason that says so (no "still loadable" warning — it is not one).
 *
 * Mutates and returns { candidate, warnings }.
 *
 * opts.imageSummary (utils/importImageSummary) records per-image outcomes for
 * the import summary popup; opts.rowNumber identifies the row (falls back to
 * the number in rowLabel, e.g. "Row 7"). A value that needs no transfer is
 * left as-is here — the caller registers it and the summary counts it as
 * uploaded, because it is already stored on our CDN or inline.
 */
const transferQuestionImages = async (candidate, rowLabel = '', opts = {}) => {
    const warnings = [];
    const prefix = rowLabel ? `${rowLabel}: ` : '';
    const { imageSummary } = opts;
    const labelMatch = /Row (\d+)/.exec(rowLabel || '');
    const rowNumber = opts.rowNumber || (labelMatch ? Number(labelMatch[1]) : null);

    const transferOne = async (value, label, type) => {
        if (!needsCloudinaryTransfer(value)) return value;
        const { url: uploaded, phase, message } = await uploadImageFromUrlDetailed(value);
        if (uploaded) {
            if (imageSummary && type) imageSummary.markUploaded(rowNumber, type);
            return uploaded;
        }
        if (phase === 'upload') {
            warnings.push(`${prefix}Image transfer failed for ${label} — stored the direct source URL (${value}).`);
            if (imageSummary && type) {
                imageSummary.markFailed(rowNumber, type, 'Cloudinary transfer failed — the direct source URL was stored instead.');
            }
        } else {
            if (imageSummary && type) {
                imageSummary.markFailed(rowNumber, type, `Image unavailable at its source URL (${message || 'download failed'}) — the stored link is likely broken.`);
            }
        }
        return value;
    };

    if (candidate.questionImage) {
        candidate.questionImage = await transferOne(candidate.questionImage, 'question image', IMAGE_TYPES.QUESTION);
    }

    if (Array.isArray(candidate.optionImages)) {
        const transferred = [];
        for (let i = 0; i < candidate.optionImages.length; i++) {
            transferred.push(await transferOne(candidate.optionImages[i], `option ${i + 1} image`, optionImageType(i + 1)));
        }
        candidate.optionImages = transferred;
    }

    if (candidate.explanationImage) {
        candidate.explanationImage = await transferOne(candidate.explanationImage, 'explanation image', IMAGE_TYPES.SOLUTION);
    }

    return { candidate, warnings };
};

module.exports = {
    convertGoogleDriveUrl,
    uploadImageFromUrl,
    uploadImageFromUrlDetailed,
    needsCloudinaryTransfer,
    transferQuestionImages
};
