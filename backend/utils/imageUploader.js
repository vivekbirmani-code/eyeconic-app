const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const { convertGoogleDriveUrl, isGoogleDriveUrl } = require('./imageUrls');
const { IMAGE_TYPES } = require('./importImageSummary');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Upload image from URL to Cloudinary
 * @param {string} imageUrl - URL of the image to upload
 * @param {string} folder - Cloudinary folder to store image
 * @returns {Promise<string|null>} - Cloudinary secure URL or null if failed
 */
const uploadImageFromUrl = async (imageUrl, folder = 'eyeconic_questions') => {
    if (!imageUrl || typeof imageUrl !== 'string') {
        return null;
    }

    // Only genuine Drive share links are rewritten. convertGoogleDriveUrl
    // matches any URL containing a 25+ char token, so applying it blindly
    // (as this path used to) corrupted perfectly good non-Drive URLs — e.g.
    // signed CDN links — into dead lh3.googleusercontent.com URLs.
    const url = isGoogleDriveUrl(imageUrl) ? convertGoogleDriveUrl(imageUrl) : imageUrl;
    if (!url) {
        console.log('⚠️ Invalid image URL:', imageUrl);
        return null;
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
            return null;
        }

        // Convert to base64
        const base64 = Buffer.from(response.data).toString('base64');
        const dataUri = `data:${contentType};base64,${base64}`;

        // Upload to Cloudinary
        console.log(`☁️ Uploading to Cloudinary...`);
        const result = await cloudinary.uploader.upload(dataUri, {
            folder: folder,
            resource_type: 'image'
        });

        console.log(`✅ Uploaded: ${result.secure_url}`);
        return result.secure_url;

    } catch (error) {
        console.error(`❌ Failed to upload image from ${url.substring(0, 60)}...`);
        console.error(`   Error: ${error.message}`);
        return null;
    }
};

/**
 * Process all images for a question and upload to Cloudinary
 * @param {Object} questionData - Question data with image URLs
 * @param {Object} [opts] - { imageSummary } per-image outcome tracker
 *   (utils/importImageSummary). questionData.rowNumber identifies the row
 *   in the import summary; without it no outcomes are recorded.
 * @returns {Promise<Object>} - Question data with Cloudinary URLs
 */
const processQuestionImages = async (questionData, opts = {}) => {
    const processed = { ...questionData };
    const { imageSummary } = opts;
    const rowNumber = questionData.rowNumber || null;

    // Process question image
    if (questionData.questionImage) {
        console.log(`\n🖼️ Processing question image...`);
        imageSummary?.expect(rowNumber, IMAGE_TYPES.QUESTION);
        const cloudinaryUrl = await uploadImageFromUrl(questionData.questionImage);
        processed.questionImage = cloudinaryUrl || null;
        if (cloudinaryUrl) {
            imageSummary?.markUploaded(rowNumber, IMAGE_TYPES.QUESTION);
        } else {
            imageSummary?.markFailed(rowNumber, IMAGE_TYPES.QUESTION, 'Upload failed — image was not stored.');
        }
    }

    // Process option images
    if (questionData.optionImages && Array.isArray(questionData.optionImages)) {
        processed.optionImages = [];
        for (let i = 0; i < questionData.optionImages.length; i++) {
            const optImg = questionData.optionImages[i];
            if (optImg) {
                console.log(`🖼️ Processing option ${i + 1} image...`);
                const cloudinaryUrl = await uploadImageFromUrl(optImg);
                processed.optionImages.push(cloudinaryUrl || '');
            } else {
                processed.optionImages.push('');
            }
        }
    }

    // Process explanation image
    if (questionData.explanationImage) {
        console.log(`🖼️ Processing explanation image...`);
        imageSummary?.expect(rowNumber, IMAGE_TYPES.SOLUTION);
        const cloudinaryUrl = await uploadImageFromUrl(questionData.explanationImage);
        processed.explanationImage = cloudinaryUrl || null;
        if (cloudinaryUrl) {
            imageSummary?.markUploaded(rowNumber, IMAGE_TYPES.SOLUTION);
        } else {
            imageSummary?.markFailed(rowNumber, IMAGE_TYPES.SOLUTION, 'Upload failed — image was not stored.');
        }
    }

    return processed;
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
 * (see imageUrls.convertGoogleDriveUrl) is kept — it is still publicly
 * loadable — and a warning is returned so the import report surfaces it.
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
        const uploaded = await uploadImageFromUrl(value);
        if (uploaded) {
            if (imageSummary && type) imageSummary.markUploaded(rowNumber, type);
            return uploaded;
        }
        warnings.push(`${prefix}Image transfer failed for ${label} — stored the direct source URL (${value}).`);
        if (imageSummary && type) {
            imageSummary.markFailed(rowNumber, type, 'Cloudinary transfer failed — the direct source URL was stored instead.');
        }
        return value;
    };

    if (candidate.questionImage) {
        candidate.questionImage = await transferOne(candidate.questionImage, 'question image', IMAGE_TYPES.QUESTION);
    }

    if (Array.isArray(candidate.optionImages)) {
        const transferred = [];
        for (let i = 0; i < candidate.optionImages.length; i++) {
            transferred.push(await transferOne(candidate.optionImages[i], `option ${i + 1} image`));
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
    processQuestionImages,
    needsCloudinaryTransfer,
    transferQuestionImages
};
