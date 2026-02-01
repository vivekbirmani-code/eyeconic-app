const cloudinary = require('cloudinary').v2;
const axios = require('axios');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Convert Google Drive share link to direct download URL
 */
const convertGoogleDriveUrl = (url) => {
    if (!url || typeof url !== 'string') return null;

    const trimmedUrl = url.trim();
    if (!trimmedUrl) return null;

    // Check if it's a Google Drive link
    if (trimmedUrl.includes('drive.google.com')) {
        // Extract file ID using regex
        const idMatch = trimmedUrl.match(/[-\w]{25,}/);
        if (idMatch) {
            // Return direct download URL
            return `https://drive.google.com/uc?export=download&id=${idMatch[0]}`;
        }
    }

    return trimmedUrl;
};

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

    const url = convertGoogleDriveUrl(imageUrl);
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
 * @returns {Promise<Object>} - Question data with Cloudinary URLs
 */
const processQuestionImages = async (questionData) => {
    const processed = { ...questionData };

    // Process question image
    if (questionData.questionImage) {
        console.log(`\n🖼️ Processing question image...`);
        const cloudinaryUrl = await uploadImageFromUrl(questionData.questionImage);
        processed.questionImage = cloudinaryUrl || null;
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
        const cloudinaryUrl = await uploadImageFromUrl(questionData.explanationImage);
        processed.explanationImage = cloudinaryUrl || null;
    }

    return processed;
};

module.exports = {
    convertGoogleDriveUrl,
    uploadImageFromUrl,
    processQuestionImages
};
