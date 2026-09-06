/**
 * transferQuestionImages: the import-time Drive -> Cloudinary transfer.
 * Network (axios) and Cloudinary are stubbed — these tests pin the CONTRACT
 * (what gets stored / what warns), not the upload mechanics.
 */
jest.mock('cloudinary', () => {
  const upload = jest.fn();
  return { v2: { uploader: { upload }, config: jest.fn() } };
});

const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const { transferQuestionImages, needsCloudinaryTransfer } = require('../../utils/imageUploader');

jest.spyOn(axios, 'get');

const DRIVE_URL = 'https://lh3.googleusercontent.com/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const CLOUDINARY_URL = 'https://res.cloudinary.com/vivek-bmpromo/image/upload/v1/eyeconic_questions/q.png';

const stubDownload = () => {
  axios.get.mockResolvedValue({
    data: Buffer.from('fake-image-bytes'),
    headers: { 'content-type': 'image/png' },
  });
};

const stubUpload = (url = CLOUDINARY_URL) => {
  cloudinary.uploader.upload.mockResolvedValue({ secure_url: url });
};

describe('needsCloudinaryTransfer', () => {
  it('flags remote non-Cloudinary URLs only', () => {
    expect(needsCloudinaryTransfer(DRIVE_URL)).toBe(true);
    expect(needsCloudinaryTransfer('https://example.org/other.png')).toBe(true);
    expect(needsCloudinaryTransfer(CLOUDINARY_URL)).toBe(false);
    expect(needsCloudinaryTransfer('data:image/png;base64,AAAA')).toBe(false);
    expect(needsCloudinaryTransfer('')).toBe(false);
    expect(needsCloudinaryTransfer(undefined)).toBe(false);
  });
});

describe('transferQuestionImages', () => {
  beforeEach(() => {
    axios.get.mockReset();
    cloudinary.uploader.upload.mockReset();
  });

  it('replaces a Drive question image with the uploaded Cloudinary URL', async () => {
    stubDownload();
    stubUpload();

    const { candidate, warnings } = await transferQuestionImages(
      { questionImage: DRIVE_URL, options: ['a', 'b'], optionImages: ['', ''], explanationImage: undefined },
      'Row 4'
    );

    expect(candidate.questionImage).toBe(CLOUDINARY_URL);
    expect(warnings).toEqual([]);
    expect(cloudinary.uploader.upload).toHaveBeenCalledTimes(1);
  });

  it('keeps the direct URL and warns when the transfer fails', async () => {
    stubDownload();
    cloudinary.uploader.upload.mockRejectedValue(new Error('boom'));

    const { candidate, warnings } = await transferQuestionImages(
      { questionImage: DRIVE_URL },
      'Row 5'
    );

    expect(candidate.questionImage).toBe(DRIVE_URL);
    expect(warnings).toEqual([`Row 5: Image transfer failed for question image — stored the direct source URL (${DRIVE_URL}).`]);
  });

  it('leaves already-Cloudinary and inline images untouched (no upload calls)', async () => {
    stubUpload();

    const { candidate, warnings } = await transferQuestionImages({
      questionImage: CLOUDINARY_URL,
      optionImages: ['', 'data:image/png;base64,AAAA'],
      explanationImage: undefined,
    });

    expect(candidate.questionImage).toBe(CLOUDINARY_URL);
    expect(cloudinary.uploader.upload).not.toHaveBeenCalled();
    expect(warnings).toEqual([]);
  });

  it('transfers option and explanation images too', async () => {
    stubDownload();
    stubUpload();

    const { candidate } = await transferQuestionImages({
      questionImage: DRIVE_URL,
      optionImages: [DRIVE_URL, ''],
      explanationImage: DRIVE_URL,
    });

    expect(candidate.optionImages[0]).toBe(CLOUDINARY_URL);
    expect(candidate.optionImages[1]).toBe('');
    expect(candidate.explanationImage).toBe(CLOUDINARY_URL);
    expect(cloudinary.uploader.upload).toHaveBeenCalledTimes(3);
  });
});
