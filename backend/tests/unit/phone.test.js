const {
  normalizeIndianPhone,
  isValidIndianPhone,
  maskPhone,
} = require('../../utils/phone');

describe('phone utils', () => {
  describe('normalizeIndianPhone', () => {
    it('normalizes accepted input variants to E.164', () => {
      expect(normalizeIndianPhone('+919876543210')).toEqual({ phone: '+919876543210' });
      expect(normalizeIndianPhone('919876543210')).toEqual({ phone: '+919876543210' });
      expect(normalizeIndianPhone('09876543210')).toEqual({ phone: '+919876543210' });
      expect(normalizeIndianPhone('9876543210')).toEqual({ phone: '+919876543210' });
      expect(normalizeIndianPhone('98765 43210')).toEqual({ phone: '+919876543210' });
      expect(normalizeIndianPhone('987-654-3210')).toEqual({ phone: '+919876543210' });
      expect(normalizeIndianPhone('(987) 6543210')).toEqual({ phone: '+919876543210' });
      expect(normalizeIndianPhone('0091 9876543210')).toEqual({ phone: '+919876543210' });
      expect(normalizeIndianPhone('  +919876543210  ')).toEqual({ phone: '+919876543210' });
    });

    it('rejects invalid numbers', () => {
      expect(normalizeIndianPhone('1234567890').error).toBe('PHONE_INVALID'); // leading 1
      expect(normalizeIndianPhone('5987654321').error).toBe('PHONE_INVALID'); // leading 5
      expect(normalizeIndianPhone('987654321').error).toBe('PHONE_INVALID'); // 9 digits
      expect(normalizeIndianPhone('98765432101').error).toBe('PHONE_INVALID'); // 11 digits
      expect(normalizeIndianPhone('98765abcde').error).toBe('PHONE_INVALID'); // letters
      expect(normalizeIndianPhone('').error).toBe('PHONE_INVALID');
      expect(normalizeIndianPhone(null).error).toBe('PHONE_INVALID');
      expect(normalizeIndianPhone(9876543210).error).toBe('PHONE_INVALID'); // non-string
    });

    it('rejects non-Indian country codes', () => {
      expect(normalizeIndianPhone('+14155551234').error).toBe('PHONE_INVALID');
    });
  });

  describe('isValidIndianPhone', () => {
    it('matches normalize results', () => {
      expect(isValidIndianPhone('+919876543210')).toBe(true);
      expect(isValidIndianPhone('12345')).toBe(false);
    });
  });

  describe('maskPhone', () => {
    it('masks the middle of the subscriber number', () => {
      expect(maskPhone('+919876543210')).toBe('+91 98xxxxx210');
    });

    it('degrades safely for unexpected input', () => {
      expect(maskPhone('short')).toBe('•••');
      expect(maskPhone(null)).toBe('•••');
    });
  });
});
