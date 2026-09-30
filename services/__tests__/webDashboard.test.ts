/**
 * App → Website handoff service (services/webDashboard.ts).
 */
import { createWebHandoffUrl, openWebDashboard } from '../webDashboard';

jest.mock('../api', () => ({
  __esModule: true,
  api: { post: jest.fn() },
}));

jest.mock('@/utils/openExternalUrl', () => ({
  __esModule: true,
  // Mirror the real guard: relative/scheme-less URLs must throw.
  openExternalUrl: jest.fn(async (url: string) => {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('openExternalUrl expects an absolute http(s) URL');
    }
  }),
}));

const api = require('../api').api as { post: jest.Mock };
const { openExternalUrl } = require('@/utils/openExternalUrl') as { openExternalUrl: jest.Mock };

const HANDOFF = {
  success: true,
  code: 'c'.repeat(43),
  url: 'https://www.eyeconicneetpg.com/app-link?code=' + 'c'.repeat(43),
  expiresAt: new Date(Date.now() + 120_000).toISOString(),
};

describe('webDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests a handoff for the destination and returns the website URL', async () => {
    api.post.mockResolvedValueOnce({ data: HANDOFF });

    const url = await createWebHandoffUrl('/tests');

    expect(api.post).toHaveBeenCalledWith('/auth/web-handoff', { dest: '/tests' });
    expect(url).toBe(HANDOFF.url);
  });

  it('opens the website URL in the external browser', async () => {
    api.post.mockResolvedValueOnce({ data: HANDOFF });
    openExternalUrl.mockResolvedValueOnce(undefined);

    await openWebDashboard('/dashboard');

    expect(openExternalUrl).toHaveBeenCalledWith(HANDOFF.url);
  });

  it('rejects relative or malformed URLs from ever being opened', async () => {
    api.post.mockResolvedValueOnce({ data: { ...HANDOFF, url: '/app-link?code=x' } });

    await expect(openWebDashboard()).rejects.toThrow();
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('surfaces a friendly error when the backend refuses', async () => {
    api.post.mockRejectedValueOnce({
      response: { data: { message: 'Too many website links requested.' } },
    });

    await expect(createWebHandoffUrl()).rejects.toThrow('Too many website links requested.');
  });
});
