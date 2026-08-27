const {
  cloudinary,
  ensureCloudinaryConfigured,
  CloudinaryConfigError,
  isCloudinarySignedConfigured,
  isCloudinaryUnsignedConfigured,
  canDeleteCloudinaryAssets,
} = require('./cloudinary');

const PROFILE_PICTURE_FOLDER = 'eyeconic_profile_pictures';
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

function detectImageMimeType(buffer) {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  if (buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12);
    if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) {
      return brand.startsWith('he') ? 'image/heic' : 'image/heif';
    }
  }

  return null;
}

function validateProfilePictureFile(file) {
  if (!file) {
    return { valid: false, message: 'No image file provided.' };
  }

  if (!file.buffer || file.buffer.length === 0) {
    return { valid: false, message: 'Uploaded image file is empty or unreadable.' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, message: 'Image is too large. Maximum size is 5MB.' };
  }

  const detectedMimeType = detectImageMimeType(file.buffer);
  if (!detectedMimeType) {
    return { valid: false, message: 'Invalid image file. Only JPEG, PNG, WebP, and HEIC are allowed.' };
  }

  if (!ALLOWED_MIME_TYPES.includes(detectedMimeType)) {
    return { valid: false, message: 'Unsupported image type. Only JPEG, PNG, WebP, and HEIC are allowed.' };
  }

  if (file.mimetype) {
    const normalizedMime = file.mimetype.toLowerCase();
    const isAllowedDeclaredMime = ALLOWED_MIME_TYPES.includes(normalizedMime)
      || normalizedMime === 'image/jpg';

    if (!isAllowedDeclaredMime) {
      return { valid: false, message: 'Unsupported image type. Only JPEG, PNG, WebP, and HEIC are allowed.' };
    }
  }

  return { valid: true, mimeType: detectedMimeType };
}

async function uploadViaUnsignedPreset(buffer, mimeType, userId) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();

  if (!cloudName || !uploadPreset) {
    throw new CloudinaryConfigError(
      'Image uploads are temporarily unavailable. Cloudinary is not configured on the server.'
    );
  }

  const formData = new FormData();
  const blob = new Blob([buffer], { type: mimeType });
  formData.append('file', blob, `profile.${mimeType.split('/')[1] || 'jpg'}`);
  formData.append('upload_preset', uploadPreset);
  formData.append('folder', PROFILE_PICTURE_FOLDER);
  formData.append('public_id', `${userId}_${Date.now()}`);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  const result = await response.json();

  if (!response.ok) {
    const errorMessage = result?.error?.message || 'Cloudinary upload failed.';
    throw new Error(errorMessage);
  }

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
}

async function uploadProfilePicture(buffer, mimeType, userId) {
  ensureCloudinaryConfigured();

  if (isCloudinarySignedConfigured()) {
    const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;
    const publicId = `${userId}_${Date.now()}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: PROFILE_PICTURE_FOLDER,
      resource_type: 'image',
      public_id: publicId,
      overwrite: false,
      transformation: {
        width: 400,
        height: 400,
        crop: 'fill',
        gravity: 'face',
        quality: 'auto',
        fetch_format: 'auto',
      },
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
    };
  }

  return uploadViaUnsignedPreset(buffer, mimeType, userId);
}

async function deleteProfilePictureAsset(publicId) {
  if (!publicId || !canDeleteCloudinaryAssets()) {
    if (publicId && !canDeleteCloudinaryAssets()) {
      console.warn(
        `Skipped Cloudinary delete for ${publicId} because signed Cloudinary credentials are not configured.`
      );
    }
    return;
  }

  try {
    ensureCloudinaryConfigured();
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch (error) {
    if (error instanceof CloudinaryConfigError) {
      throw error;
    }
    console.error(`Failed to delete profile picture asset ${publicId}:`, error);
  }
}

function toClientUser(user) {
  const userObject = user.toObject ? user.toObject() : { ...user };
  delete userObject.password;
  delete userObject.profilePicturePublicId;
  return userObject;
}

module.exports = {
  PROFILE_PICTURE_FOLDER,
  MAX_FILE_SIZE_BYTES,
  ALLOWED_MIME_TYPES,
  CloudinaryConfigError,
  detectImageMimeType,
  validateProfilePictureFile,
  uploadProfilePicture,
  deleteProfilePictureAsset,
  toClientUser,
};
