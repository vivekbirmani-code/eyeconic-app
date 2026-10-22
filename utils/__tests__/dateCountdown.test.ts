import { formatCountdown } from '../date';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatCountdown — schedule badge countdowns', () => {
  it('collapses anything under a minute (and invalid input) to "<1m"', () => {
    expect(formatCountdown(0)).toBe('<1m');
    expect(formatCountdown(30 * 1000)).toBe('<1m');
    expect(formatCountdown(-5 * MINUTE)).toBe('<1m');
    expect(formatCountdown(NaN)).toBe('<1m');
  });

  it('formats minutes, hours and days compactly', () => {
    expect(formatCountdown(45 * MINUTE)).toBe('45m');
    expect(formatCountdown(3 * HOUR + 12 * MINUTE)).toBe('3h 12m');
    expect(formatCountdown(2 * HOUR)).toBe('2h');
    expect(formatCountdown(2 * DAY + 4 * HOUR + 7 * MINUTE)).toBe('2d 4h');
    expect(formatCountdown(5 * DAY)).toBe('5d');
  });

  it('rounds partial minutes down, never up across unit boundaries', () => {
    // 59.9s still "<1m"; 60.5s is "1m", not 2m
    expect(formatCountdown(59.9 * 1000)).toBe('<1m');
    expect(formatCountdown(60.5 * 1000)).toBe('1m');
    // 90 minutes shows as 1h 30m
    expect(formatCountdown(90 * MINUTE)).toBe('1h 30m');
  });
});
