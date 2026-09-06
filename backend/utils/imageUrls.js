// Shared image-URL helpers for every question-image write path and the
// repair tooling. Single source of truth — previously the placeholder host
// list and the Google Drive conversion lived in (drifting) copies.

// Hosts that only ever appear in template/sample rows — nothing real is
// ever hosted here.
const PLACEHOLDER_IMAGE_HOSTS = new Set([
    'example.com',
    'www.example.com',
    'example.org',
    'www.example.org',
    'example.net',
    'www.example.net',
]);

const isPlaceholderImageHost = (value) => {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        return PLACEHOLDER_IMAGE_HOSTS.has(new URL(value.trim()).hostname.toLowerCase());
    } catch {
        return false;
    }
};

/**
 * Converts a Google Drive share link to its direct-delivery form so it can
 * actually be fetched by an <img> tag (and by the import-time Cloudinary
 * transfer). lh3.googleusercontent.com is Google's dedicated image delivery
 * host: it serves the original bytes with real image content-types, needs no
 * cookies, and never serves the virus-scan interstitial — unlike
 * drive.google.com/uc?export=view, which throttles consumer traffic and
 * intermittently answers with an HTML shell instead of the image.
 * Non-Drive URLs are returned unchanged, and the conversion is idempotent
 * (an already-converted /d/<id> URL maps to itself).
 */
const convertGoogleDriveUrl = (url) => {
    const idMatch = url.match(/[-\w]{25,}/);
    if (!idMatch) return url;
    return `https://lh3.googleusercontent.com/d/${idMatch[0]}`;
};

const isGoogleDriveUrl = (url) => url.includes('drive.google.com') || url.includes('lh3.googleusercontent.com');

module.exports = {
    PLACEHOLDER_IMAGE_HOSTS,
    isPlaceholderImageHost,
    convertGoogleDriveUrl,
    isGoogleDriveUrl,
};
