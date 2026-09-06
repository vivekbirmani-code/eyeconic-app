const {
  convertGoogleDriveUrl,
  isGoogleDriveUrl,
  isPlaceholderImageHost,
} = require('../../utils/imageUrls');

describe('convertGoogleDriveUrl', () => {
  const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const DIRECT = `https://lh3.googleusercontent.com/d/${FILE_ID}`;

  it('converts a /file/d/<id>/view share link to the direct delivery host', () => {
    expect(convertGoogleDriveUrl(`https://drive.google.com/file/d/${FILE_ID}/view?usp=drive_link`)).toBe(DIRECT);
  });

  it('converts an open?id= link', () => {
    expect(convertGoogleDriveUrl(`https://drive.google.com/open?id=${FILE_ID}`)).toBe(DIRECT);
  });

  it('is idempotent for an already-converted lh3 URL', () => {
    expect(convertGoogleDriveUrl(DIRECT)).toBe(DIRECT);
  });

  it('leaves non-Drive URLs unchanged', () => {
    expect(convertGoogleDriveUrl('https://res.cloudinary.com/demo/image/upload/a.png'))
      .toBe('https://res.cloudinary.com/demo/image/upload/a.png');
  });

  it('recognizes both Drive hosts', () => {
    expect(isGoogleDriveUrl(`https://drive.google.com/file/d/${FILE_ID}/view`)).toBe(true);
    expect(isGoogleDriveUrl(DIRECT)).toBe(true);
    expect(isGoogleDriveUrl('https://example.com/x.png')).toBe(false);
  });
});

describe('isPlaceholderImageHost', () => {
  it('matches only the known template placeholder hosts', () => {
    expect(isPlaceholderImageHost('https://example.com/sample.png')).toBe(true);
    expect(isPlaceholderImageHost('https://www.example.org/a.jpg')).toBe(true);
    expect(isPlaceholderImageHost('https://res.cloudinary.com/x/y.png')).toBe(false);
    expect(isPlaceholderImageHost('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/view')).toBe(false);
    expect(isPlaceholderImageHost('')).toBe(false);
    expect(isPlaceholderImageHost(null)).toBe(false);
  });
});
