jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload: jest.fn().mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/test/image/upload/v1/eyeconic_profile_pictures/test.jpg',
        public_id: 'eyeconic_profile_pictures/test_user_123',
      }),
      destroy: jest.fn().mockResolvedValue({ result: 'ok' }),
    },
  },
}));

const request = require('supertest');
const db = require('../helpers/db');
const { buildApp, createUser } = require('../helpers/testApp');
const User = require('../../models/User');
const { cloudinary } = require('../../utils/cloudinary');

let app;

const VALID_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',
  'base64'
);

const INVALID_FILE = Buffer.from('not-an-image-file');

beforeAll(async () => {
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
  process.env.CLOUDINARY_API_KEY = 'test-key';
  process.env.CLOUDINARY_API_SECRET = 'test-secret';
  delete process.env.CLOUDINARY_UPLOAD_PRESET;
  await db.connect();
  app = buildApp();
});

afterAll(async () => {
  await db.closeDatabase();
});

beforeEach(async () => {
  await db.clearDatabase();
  jest.clearAllMocks();
});

describe('Profile picture API', () => {
  it('allows an authenticated student to upload a profile picture', async () => {
    const student = await createUser({ role: 'student', name: 'Priya Singh' });

    const response = await request(app)
      .post('/api/users/profile-picture')
      .set('Authorization', `Bearer ${student.token}`)
      .attach('image', VALID_JPEG, {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.user.profilePicture).toContain('cloudinary.com');
    expect(response.body.user.profilePicturePublicId).toBeUndefined();

    const updatedUser = await User.findById(student.user._id);
    expect(updatedUser.profilePicturePublicId).toBe('eyeconic_profile_pictures/test_user_123');
  });

  it('allows an authenticated mentor to upload a profile picture', async () => {
    const mentor = await createUser({ role: 'mentor', name: 'Dr. Sharma' });

    const response = await request(app)
      .post('/api/users/profile-picture')
      .set('Authorization', `Bearer ${mentor.token}`)
      .attach('image', VALID_JPEG, {
        filename: 'mentor.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(200);
    expect(response.body.user.profilePicture).toBeTruthy();
  });

  it('rejects unauthenticated upload requests', async () => {
    const response = await request(app)
      .post('/api/users/profile-picture')
      .attach('image', VALID_JPEG, {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(401);
  });

  it('rejects invalid file types', async () => {
    const student = await createUser({ role: 'student' });

    const response = await request(app)
      .post('/api/users/profile-picture')
      .set('Authorization', `Bearer ${student.token}`)
      .attach('image', INVALID_FILE, {
        filename: 'profile.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/invalid image/i);
  });

  it('replaces an existing profile picture and deletes the previous asset', async () => {
    const student = await createUser({ role: 'student' });
    await User.findByIdAndUpdate(student.user._id, {
      profilePicture: 'https://res.cloudinary.com/test/old.jpg',
      profilePicturePublicId: 'eyeconic_profile_pictures/old_asset',
    });

    cloudinary.uploader.upload.mockResolvedValueOnce({
      secure_url: 'https://res.cloudinary.com/test/image/upload/v1/eyeconic_profile_pictures/new.jpg',
      public_id: 'eyeconic_profile_pictures/new_asset',
    });

    const response = await request(app)
      .post('/api/users/profile-picture')
      .set('Authorization', `Bearer ${student.token}`)
      .attach('image', VALID_JPEG, {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      });

    expect(response.status).toBe(200);
    expect(response.body.user.profilePicture).toContain('new.jpg');
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
      'eyeconic_profile_pictures/old_asset',
      { resource_type: 'image' }
    );
  });

  it('removes a profile picture for the authenticated user', async () => {
    const student = await createUser({ role: 'student' });
    await User.findByIdAndUpdate(student.user._id, {
      profilePicture: 'https://res.cloudinary.com/test/image/upload/v1/test.jpg',
      profilePicturePublicId: 'eyeconic_profile_pictures/remove_me',
    });

    const response = await request(app)
      .delete('/api/users/profile-picture')
      .set('Authorization', `Bearer ${student.token}`);

    expect(response.status).toBe(200);
    expect(response.body.user.profilePicture).toBeNull();
    expect(cloudinary.uploader.destroy).toHaveBeenCalledWith(
      'eyeconic_profile_pictures/remove_me',
      { resource_type: 'image' }
    );

    const updatedUser = await User.findById(student.user._id);
    expect(updatedUser.profilePicture).toBeNull();
    expect(updatedUser.profilePicturePublicId).toBeNull();
  });

  it('only modifies the authenticated user profile picture', async () => {
    const studentA = await createUser({ role: 'student', name: 'Student A' });
    const studentB = await createUser({ role: 'student', name: 'Student B' });

    await request(app)
      .post('/api/users/profile-picture')
      .set('Authorization', `Bearer ${studentA.token}`)
      .attach('image', VALID_JPEG, {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      });

    const studentBRecord = await User.findById(studentB.user._id);
    expect(studentBRecord.profilePicture).toBeNull();
  });

  it('returns 503 when Cloudinary is not configured', async () => {
    const student = await createUser({ role: 'student' });
    const originalCloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const originalApiKey = process.env.CLOUDINARY_API_KEY;
    const originalApiSecret = process.env.CLOUDINARY_API_SECRET;
    const originalUploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;

    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    delete process.env.CLOUDINARY_UPLOAD_PRESET;

    const response = await request(app)
      .post('/api/users/profile-picture')
      .set('Authorization', `Bearer ${student.token}`)
      .attach('image', VALID_JPEG, {
        filename: 'profile.jpg',
        contentType: 'image/jpeg',
      });

    process.env.CLOUDINARY_CLOUD_NAME = originalCloudName;
    process.env.CLOUDINARY_API_KEY = originalApiKey;
    process.env.CLOUDINARY_API_SECRET = originalApiSecret;
    process.env.CLOUDINARY_UPLOAD_PRESET = originalUploadPreset;

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('CLOUDINARY_NOT_CONFIGURED');
  });
});
