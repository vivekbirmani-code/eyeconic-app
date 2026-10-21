/**
 * Policy-warning copy coverage (Phase 6, plan §9.2/D7 + §29.3).
 *
 * The server rules engine selects warning CODES (backend
 * utils/proctoring/rulesEngine.js WARN_CODES); the client renders words from
 * utils/proctoringCopy.ts. This suite mirrors the server's code list and
 * asserts every code has copy — the two sides can never drift silently. Also
 * enforces the banned-language rule on every warning string (no verdict
 * language, no "eye tracking"/"gaze" claims — D6/D7).
 */

import { PROCTORING_COPY, CONSENT_TEXT_VERSION } from '../../utils/proctoringCopy';

/** Mirror of backend rulesEngine.WARN_CODES — update both together, deliberately. */
const SERVER_WARN_CODES = [
  'warn.focus',
  'warn.final',
  'warn.multipleFaces',
  'warn.faceMissing',
  'warn.camera',
  'warn.headTurn',
] as const;

/** Mirror of the backend registry's banned-identifier pattern + D7 copy bans. */
const BANNED = /CHEAT|FRAUD|IMPERSONAT|PLAGIAR|DECEIV|DISHONEST|GUILT|eye tracking|gaze detection|biometric/i;

describe('proctoring warning copy (Phase 6, D7)', () => {
  test('every server warning code has title + body copy', () => {
    for (const code of SERVER_WARN_CODES) {
      const copy = PROCTORING_COPY.warnings.byCode[code];
      expect(copy).toBeDefined();
      expect(typeof copy.title).toBe('string');
      expect(copy.title.length).toBeGreaterThan(3);
      expect(typeof copy.body).toBe('string');
      expect(copy.body.length).toBeGreaterThan(10);
    }
  });

  test('the auto-submitted notice exists with title + body', () => {
    const copy = PROCTORING_COPY.warnings.autoSubmitted;
    expect(copy.title).toBe('Test submitted');
    expect(copy.body).toContain('submitted automatically');
    // The appeal path is named (§20.3 — the student is never left without one).
    expect(copy.body.toLowerCase()).toContain('mentor');
  });

  test('no banned language in any warning string (never a verdict, never gaze claims)', () => {
    const strings: string[] = [
      PROCTORING_COPY.warnings.autoSubmitted.title,
      PROCTORING_COPY.warnings.autoSubmitted.body,
    ];
    for (const code of Object.keys(PROCTORING_COPY.warnings.byCode)) {
      strings.push(PROCTORING_COPY.warnings.byCode[code].title);
      strings.push(PROCTORING_COPY.warnings.byCode[code].body);
    }
    for (const text of strings) {
      expect(BANNED.test(text)).toBe(false);
    }
  });

  test('FINAL_WARN copy names the consequence plainly (never silent, §20.3)', () => {
    const final = PROCTORING_COPY.warnings.byCode['warn.final'];
    expect(final.body.toLowerCase()).toContain('submitted');
  });

  test('warning copy additions leave the consent version untouched (auditable, §9.2)', () => {
    // Consent binds to the copy the student SAW; adding warning strings must
    // not silently invalidate recorded consents.
    expect(CONSENT_TEXT_VERSION).toBe('2026-09-v1');
    expect(PROCTORING_COPY.consent.lines).toHaveLength(8);
  });
});
