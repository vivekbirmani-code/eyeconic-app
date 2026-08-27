const {
  detectImageMimeType,
  validateProfilePictureFile,
} = require('../../utils/profilePicture');

const VALID_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',
  'base64'
);

describe('profilePicture validation', () => {
  it('detects jpeg magic bytes', () => {
    expect(detectImageMimeType(VALID_JPEG)).toBe('image/jpeg');
  });

  it('rejects non-image buffers', () => {
    expect(detectImageMimeType(Buffer.from('hello'))).toBeNull();
  });

  it('validates a supported image file', () => {
    const result = validateProfilePictureFile({
      buffer: VALID_JPEG,
      size: VALID_JPEG.length,
      mimetype: 'image/jpeg',
    });

    expect(result.valid).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
  });

  it('rejects oversized files', () => {
    const result = validateProfilePictureFile({
      buffer: VALID_JPEG,
      size: 6 * 1024 * 1024,
      mimetype: 'image/jpeg',
    });

    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/too large/i);
  });
});
