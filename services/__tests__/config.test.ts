jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { hostUri: '192.168.1.10:8081' },
  },
}));

describe('api config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    (global as { __DEV__?: boolean }).__DEV__ = true;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses Expo debugger host for iOS development', () => {
    const { getApiBaseURL, getApiHost } = require('../config');
    expect(getApiHost()).toBe('http://192.168.1.10:3000');
    expect(getApiBaseURL()).toBe('http://192.168.1.10:3000/api');
  });

  it('prefers EXPO_PUBLIC_API_URL when set', () => {
    process.env.EXPO_PUBLIC_API_URL = 'http://10.0.0.5:3000/api';
    const { getApiBaseURL } = require('../config');
    expect(getApiBaseURL()).toBe('http://10.0.0.5:3000/api');
  });

  it('does not use a hardcoded LAN fallback IP', () => {
    jest.doMock('expo-constants', () => ({
      __esModule: true,
      default: { expoConfig: {} },
    }));
    jest.resetModules();
    const { getApiHost } = require('../config');
    expect(getApiHost()).not.toContain('172.20.10.4');
    expect(getApiHost()).toBe('http://localhost:3000');
  });

  it('uses production host for non-dev builds', () => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    jest.resetModules();
    const { getApiBaseURL } = require('../config');
    expect(getApiBaseURL()).toBe('https://eyeconic-app-prod-1r8o.onrender.com/api');
  });
});
