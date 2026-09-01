import {
  combineDateAndTime,
  isValidQuizWindow,
  startOfMinute,
} from '../quizDateTime';

describe('startOfMinute', () => {
  it('zeroes seconds and milliseconds without mutating the input', () => {
    const original = new Date(2026, 7, 31, 17, 0, 37, 543); // 31 Aug 2026, 5:00:37.543 PM
    const normalized = startOfMinute(original);

    expect(normalized.getSeconds()).toBe(0);
    expect(normalized.getMilliseconds()).toBe(0);
    expect(normalized.getHours()).toBe(17);
    expect(normalized.getMinutes()).toBe(0);
    expect(original.getSeconds()).toBe(37); // input untouched
  });

  it('returns equal instants when seconds are already zero', () => {
    const original = new Date(2026, 7, 31, 17, 35, 0, 0);
    expect(startOfMinute(original).getTime()).toBe(original.getTime());
  });
});

describe('combineDateAndTime — date and time parts stay independent', () => {
  it('takes the calendar date from datePart and the time-of-day from timePart', () => {
    const datePart = new Date(2026, 8, 1, 23, 59, 59); // 1 Sep (time should be ignored)
    const timePart = new Date(2020, 0, 15, 17, 35, 12); // 5:35 PM (date should be ignored)

    const combined = combineDateAndTime(datePart, timePart);

    expect(combined.getFullYear()).toBe(2026);
    expect(combined.getMonth()).toBe(8);
    expect(combined.getDate()).toBe(1);
    expect(combined.getHours()).toBe(17);
    expect(combined.getMinutes()).toBe(35);
    expect(combined.getSeconds()).toBe(0);
    expect(combined.getMilliseconds()).toBe(0);
  });

  it('changing the picked time never changes the picked date (wizard TEST 7/8/9)', () => {
    const pickedDate = new Date(2026, 7, 31, 9, 0, 0); // 31 Aug

    const withFivePM = combineDateAndTime(pickedDate, new Date(2026, 0, 1, 17, 0, 0));
    const withFiveAM = combineDateAndTime(pickedDate, new Date(2026, 0, 1, 5, 0, 0));

    // Same calendar date, AM and PM alike — only the time-of-day differs.
    expect(withFivePM.getFullYear()).toBe(withFiveAM.getFullYear());
    expect(withFivePM.getMonth()).toBe(withFiveAM.getMonth());
    expect(withFivePM.getDate()).toBe(withFiveAM.getDate());
    expect(withFivePM.getHours()).toBe(17);
    expect(withFiveAM.getHours()).toBe(5);
  });

  it('changing the picked date never changes the picked time', () => {
    const pickedTime = new Date(2026, 0, 1, 17, 35, 0); // 5:35 PM

    const aug31 = combineDateAndTime(new Date(2026, 7, 31, 3, 2, 1), pickedTime);
    const sep01 = combineDateAndTime(new Date(2026, 8, 1, 3, 2, 1), pickedTime);

    expect(aug31.getDate()).toBe(31);
    expect(sep01.getDate()).toBe(1);
    [aug31, sep01].forEach((d) => {
      expect(d.getHours()).toBe(17);
      expect(d.getMinutes()).toBe(35);
    });
  });

  it('keeps a cross-day window ordering (11:30 PM start, 12:30 AM next day end)', () => {
    const start = new Date(2026, 7, 31, 23, 30, 0);
    const end = combineDateAndTime(new Date(2026, 8, 1, 0, 0, 0), new Date(2026, 0, 1, 0, 30, 0));
    expect(end.getTime()).toBe(start.getTime() + 60 * 60 * 1000); // +1 hour
  });
});

describe('isValidQuizWindow — shared business rule', () => {
  it('accepts a same-day 30-minute gap', () => {
    expect(
      isValidQuizWindow(new Date(2026, 7, 31, 17, 0), new Date(2026, 7, 31, 17, 30))
    ).toBe(true);
  });

  it('accepts each end being individually unset', () => {
    expect(isValidQuizWindow(null, new Date())).toBe(true);
    expect(isValidQuizWindow(new Date(), undefined)).toBe(true);
    expect(isValidQuizWindow(null, undefined)).toBe(true);
  });

  it('rejects end-before-start on the same calendar date (the screenshot state)', () => {
    // Start 5:00 PM, End 5:35 AM — same date, earlier time.
    expect(
      isValidQuizWindow(new Date(2026, 7, 31, 17, 0, 37), new Date(2026, 7, 31, 5, 35, 54))
    ).toBe(false);
  });

  it('rejects equal start and end (end must be strictly after start)', () => {
    const same = new Date(2026, 7, 31, 17, 0, 0);
    expect(isValidQuizWindow(same, new Date(same.getTime()))).toBe(false);
  });

  it('accepts any strictly-after end, even a sub-second gap', () => {
    const start = new Date(2026, 7, 31, 17, 0, 0);
    expect(isValidQuizWindow(start, new Date(start.getTime() + 60_000))).toBe(true);
    expect(isValidQuizWindow(start, new Date(start.getTime() + 999))).toBe(true);
    expect(isValidQuizWindow(start, new Date(start.getTime() - 1))).toBe(false);
  });
});
