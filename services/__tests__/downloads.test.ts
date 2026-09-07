import AsyncStorage from '@react-native-async-storage/async-storage';
import { openExternalUrl } from '../../utils/openExternalUrl';
import {
  downloadApiReport,
  getReportDownloadErrorMessage,
  ReportDownloadError,
} from '../downloads';

let platformOS = 'ios';

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return platformOS;
    },
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { hostUri: '192.168.1.10:8081' },
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
  },
}));

jest.mock('../../utils/openExternalUrl', () => ({
  openExternalUrl: jest.fn(),
}));

const getItemMock = AsyncStorage.getItem as jest.Mock;
const openExternalUrlMock = openExternalUrl as jest.Mock;

describe('downloadApiReport', () => {
  beforeEach(() => {
    jest.resetModules();
    (global as { __DEV__?: boolean }).__DEV__ = true;
    process.env = { ...process.env };
    delete process.env.EXPO_PUBLIC_API_URL;
    platformOS = 'ios';
    getItemMock.mockReset().mockResolvedValue('token-123');
    openExternalUrlMock.mockReset().mockResolvedValue(undefined);
  });

  it('builds an absolute URL from the API base, not axios defaults', async () => {
    await downloadApiReport('/quizzes/analytics/test-report/abc/csv');

    expect(openExternalUrlMock).toHaveBeenCalledTimes(1);
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'http://192.168.1.10:3000/api/quizzes/analytics/test-report/abc/csv?token=token-123'
    );
  });

  it('normalizes a missing leading slash', async () => {
    await downloadApiReport('quizzes/export');
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'http://192.168.1.10:3000/api/quizzes/export?token=token-123'
    );
  });

  it('appends the token with & when the path already has a query', async () => {
    await downloadApiReport('/quizzes/export?format=csv');
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'http://192.168.1.10:3000/api/quizzes/export?format=csv&token=token-123'
    );
  });

  it('URL-encodes the token', async () => {
    getItemMock.mockResolvedValue('a+b&c=d');
    await downloadApiReport('/quizzes/export');
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'http://192.168.1.10:3000/api/quizzes/export?token=a%2Bb%26c%3Dd'
    );
  });

  it('rejects with a typed error when no auth token is stored', async () => {
    getItemMock.mockResolvedValue(null);

    await expect(downloadApiReport('/quizzes/export')).rejects.toMatchObject({
      name: 'ReportDownloadError',
      code: 'MISSING_AUTH_TOKEN',
    });
    expect(openExternalUrlMock).not.toHaveBeenCalled();
    expect(getReportDownloadErrorMessage(new ReportDownloadError('MISSING_AUTH_TOKEN', 'x'))).toBe(
      'Your session has expired. Please log in again and try.'
    );
  });

  it('rejects relative URLs instead of opening them', async () => {
    process.env.EXPO_PUBLIC_API_URL = '/relative-backend';

    await expect(downloadApiReport('/quizzes/export')).rejects.toMatchObject({
      name: 'ReportDownloadError',
      code: 'INVALID_DOWNLOAD_URL',
    });
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('downloads via an in-page anchor on web (no popup blocking)', async () => {
    platformOS = 'web';
    const clicks: unknown[] = [];
    const anchor = {
      href: '',
      rel: '',
      click: jest.fn(() => clicks.push('click')),
      remove: jest.fn(),
    };
    const created: unknown[] = [];
    const documentMock = {
      createElement: jest.fn(() => anchor),
      body: { appendChild: jest.fn((node) => created.push(node)) },
    };
    (global as unknown as { document: unknown }).document = documentMock;

    try {
      await downloadApiReport('/quizzes/export');
      expect(openExternalUrlMock).not.toHaveBeenCalled();
      expect(documentMock.createElement).toHaveBeenCalledWith('a');
      expect(anchor.click).toHaveBeenCalledTimes(1);
      expect(anchor.href).toBe('http://localhost:3000/api/quizzes/export?token=token-123');
      expect(anchor.rel).toBe('noopener');
      expect(anchor.remove).toHaveBeenCalledTimes(1);
    } finally {
      delete (global as unknown as { document?: unknown }).document;
    }
  });
});
