const cloudinary = require('cloudinary').v2;

const REQUIRED_SIGNED_ENV_VARS = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];

function readCloudinaryConfig() {
  return {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME?.trim() || '',
    api_key: process.env.CLOUDINARY_API_KEY?.trim() || '',
    api_secret: process.env.CLOUDINARY_API_SECRET?.trim() || '',
    upload_preset: process.env.CLOUDINARY_UPLOAD_PRESET?.trim() || '',
  };
}

function getMissingSignedCloudinaryEnvVars() {
  return REQUIRED_SIGNED_ENV_VARS.filter((name) => !process.env[name]?.trim());
}

function isCloudinarySignedConfigured() {
  return getMissingSignedCloudinaryEnvVars().length === 0;
}

function isCloudinaryUnsignedConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
    process.env.CLOUDINARY_UPLOAD_PRESET?.trim()
  );
}

function isCloudinaryConfigured() {
  return isCloudinarySignedConfigured() || isCloudinaryUnsignedConfigured();
}

function configureCloudinary() {
  const config = readCloudinaryConfig();
  cloudinary.config({
    cloud_name: config.cloud_name,
    api_key: config.api_key || undefined,
    api_secret: config.api_secret || undefined,
  });
  return config;
}

class CloudinaryConfigError extends Error {
  constructor(message, missingVars = getMissingCloudinarySetupVars()) {
    super(message);
    this.name = 'CloudinaryConfigError';
    this.statusCode = 503;
    this.code = 'CLOUDINARY_NOT_CONFIGURED';
    this.missingVars = missingVars;
    this.expose = true;
  }
}

function getMissingCloudinarySetupVars() {
  if (isCloudinaryConfigured()) {
    return [];
  }

  return [
  ...getMissingSignedCloudinaryEnvVars(),
  'CLOUDINARY_UPLOAD_PRESET (or full signed CLOUDINARY_* credentials)',
  ];
}

function ensureCloudinaryConfigured() {
  if (!isCloudinaryConfigured()) {
    throw new CloudinaryConfigError(
      'Image uploads are temporarily unavailable. Cloudinary is not configured on the server.',
      getMissingCloudinarySetupVars()
    );
  }

  return configureCloudinary();
}

function canDeleteCloudinaryAssets() {
  return isCloudinarySignedConfigured();
}

function getCloudinaryHealthStatus() {
  const signedConfigured = isCloudinarySignedConfigured();
  const unsignedConfigured = isCloudinaryUnsignedConfigured();
  const configured = signedConfigured || unsignedConfigured;

  return {
    status: configured ? 'healthy' : 'unconfigured',
    configured,
    mode: signedConfigured ? 'signed' : unsignedConfigured ? 'unsigned_preset' : 'none',
    canDeleteAssets: canDeleteCloudinaryAssets(),
    missingVars: configured ? [] : getMissingCloudinarySetupVars(),
    cloudName: configured ? process.env.CLOUDINARY_CLOUD_NAME : null,
    uploadPreset: unsignedConfigured ? process.env.CLOUDINARY_UPLOAD_PRESET : null,
  };
}

// Initial configuration attempt at module load.
configureCloudinary();

module.exports = {
  cloudinary,
  CloudinaryConfigError,
  configureCloudinary,
  ensureCloudinaryConfigured,
  getCloudinaryHealthStatus,
  getMissingSignedCloudinaryEnvVars,
  getMissingCloudinarySetupVars,
  isCloudinaryConfigured,
  isCloudinarySignedConfigured,
  isCloudinaryUnsignedConfigured,
  canDeleteCloudinaryAssets,
};
