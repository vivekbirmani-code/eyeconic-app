/**
 * importImageSummary: the per-image outcome tracker behind the Image Upload
 * Summary popup, plus its integration with both import image pipelines
 * (transferQuestionImages / processQuestionImages). Network (axios) and
 * Cloudinary are stubbed — these tests pin the counting CONTRACT.
 */
jest.mock('cloudinary', () => {
  const upload = jest.fn();
  return { v2: { uploader: { upload }, config: jest.fn() } };
});

const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const { IMAGE_TYPES, createImageImportSummary } = require('../../utils/importImageSummary');
const { transferQuestionImages, processQuestionImages } = require('../../utils/imageUploader');

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

describe('createImageImportSummary — counting contract', () => {
  it('counts each (row, type) slot once — one question + one solution image per row is 2, re-registration is not more', () => {
    const summary = createImageImportSummary();
    summary.expect(4, IMAGE_TYPES.QUESTION);
    summary.expect(4, IMAGE_TYPES.SOLUTION);
    summary.expect(4, IMAGE_TYPES.QUESTION); // duplicate registration
    summary.markUploaded(4, IMAGE_TYPES.QUESTION);
    summary.markUploaded(4, IMAGE_TYPES.SOLUTION);

    expect(summary.toJSON()).toEqual({
      total: 2,
      uploaded: 2,
      failed: 0,
      failures: [],
    });
  });

  it('reports pending entries (no transfer needed) as uploaded', () => {
    const summary = createImageImportSummary();
    summary.expect(2, IMAGE_TYPES.QUESTION);
    expect(summary.toJSON().uploaded).toBe(1);
  });

  it('tracks failures individually with row and type, in sheet order', () => {
    const summary = createImageImportSummary();
    summary.expect(9, IMAGE_TYPES.SOLUTION);
    summary.markFailed(9, IMAGE_TYPES.SOLUTION, 'Upload failed — image was not stored.');
    summary.expect(3, IMAGE_TYPES.QUESTION);
    summary.markFailed(3, IMAGE_TYPES.QUESTION, 'Cloudinary transfer failed — the direct source URL was stored instead.');

    const json = summary.toJSON();
    expect(json).toMatchObject({
      total: 2,
      uploaded: 0,
      failed: 2,
    });
    expect(json.failures).toEqual([
      { row: 3, type: 'question', reason: 'Cloudinary transfer failed — the direct source URL was stored instead.' },
      { row: 9, type: 'solution', reason: 'Upload failed — image was not stored.' },
    ]);
  });

  it('failRow flips only that row\'s images, and never un-fails', () => {
    const summary = createImageImportSummary();
    summary.expect(5, IMAGE_TYPES.QUESTION);
    summary.expect(5, IMAGE_TYPES.SOLUTION);
    summary.expect(6, IMAGE_TYPES.QUESTION);
    summary.markUploaded(6, IMAGE_TYPES.QUESTION);

    summary.failRow(5, 'Question was not saved — image not linked.');

    const json = summary.toJSON();
    expect(json.failed).toBe(2);
    expect(json.uploaded).toBe(1);
    expect(json.failures.map((f) => f.row)).toEqual([5, 5]);

    // An already-failed entry keeps its original reason.
    summary.failRow(5, 'later reason');
    expect(json.failures[0].reason).toBe('Question was not saved — image not linked.');
  });

  it('ignores registrations without a row number', () => {
    const summary = createImageImportSummary();
    summary.expect(null, IMAGE_TYPES.QUESTION);
    expect(summary.toJSON().total).toBe(0);
  });
});

describe('transferQuestionImages — imageSummary integration (bank import path)', () => {
  beforeEach(() => {
    axios.get.mockReset();
    cloudinary.uploader.upload.mockReset();
  });

  it('marks a transferred question image uploaded', async () => {
    stubDownload();
    stubUpload();
    const summary = createImageImportSummary();
    summary.expect(4, IMAGE_TYPES.QUESTION);

    await transferQuestionImages(
      { questionImage: DRIVE_URL, optionImages: [''], explanationImage: undefined },
      'Row 4',
      { rowNumber: 4, imageSummary: summary }
    );

    expect(summary.toJSON()).toEqual({ total: 1, uploaded: 1, failed: 0, failures: [] });
  });

  it('marks a failed transfer failed (direct URL kept), keyed by the row from the label', async () => {
    stubDownload();
    cloudinary.uploader.upload.mockRejectedValue(new Error('boom'));
    const summary = createImageImportSummary();
    summary.expect(7, IMAGE_TYPES.QUESTION);
    summary.expect(7, IMAGE_TYPES.SOLUTION);

    await transferQuestionImages(
      { questionImage: DRIVE_URL, explanationImage: DRIVE_URL },
      'Row 7',
      { imageSummary: summary }
    );

    const json = summary.toJSON();
    expect(json.failed).toBe(2);
    expect(json.failures).toEqual([
      { row: 7, type: 'question', reason: 'Cloudinary transfer failed — the direct source URL was stored instead.' },
      { row: 7, type: 'solution', reason: 'Cloudinary transfer failed — the direct source URL was stored instead.' },
    ]);
  });

  it('does not mark outcomes for option images (not part of the summary)', async () => {
    stubDownload();
    stubUpload();
    const summary = createImageImportSummary();

    const { candidate } = await transferQuestionImages(
      { optionImages: [DRIVE_URL, ''] },
      'Row 2',
      { rowNumber: 2, imageSummary: summary }
    );

    expect(candidate.optionImages[0]).toBe(CLOUDINARY_URL);
    expect(summary.toJSON().total).toBe(0);
  });
});

describe('processQuestionImages — imageSummary integration (quiz import path)', () => {
  beforeEach(() => {
    axios.get.mockReset();
    cloudinary.uploader.upload.mockReset();
  });

  it('marks question and solution images uploaded', async () => {
    stubDownload();
    stubUpload();
    const summary = createImageImportSummary();

    await processQuestionImages(
      { rowNumber: 3, questionImage: DRIVE_URL, explanationImage: DRIVE_URL },
      { imageSummary: summary }
    );

    expect(summary.toJSON()).toEqual({ total: 2, uploaded: 2, failed: 0, failures: [] });
  });

  it('marks a dropped image (upload returned null) failed', async () => {
    stubDownload();
    cloudinary.uploader.upload.mockRejectedValue(new Error('boom'));
    const summary = createImageImportSummary();

    const processed = await processQuestionImages(
      { rowNumber: 3, questionImage: DRIVE_URL },
      { imageSummary: summary }
    );

    expect(processed.questionImage).toBeNull();
    expect(summary.toJSON()).toEqual({
      total: 1,
      uploaded: 0,
      failed: 1,
      failures: [{ row: 3, type: 'question', reason: 'Upload failed — image was not stored.' }],
    });
  });

  it('records nothing without a rowNumber (non-import callers)', async () => {
    stubDownload();
    stubUpload();
    const summary = createImageImportSummary();

    await processQuestionImages({ questionImage: DRIVE_URL }, { imageSummary: summary });

    expect(summary.toJSON().total).toBe(0);
  });
});
