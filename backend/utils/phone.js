// Phone helpers for the public-quiz guest flow.
// v1 supports Indian (+91) numbers only — the current business market.
// Everything normalizes to E.164 (+91XXXXXXXXXX); non-Indian numbers are
// rejected with a clear message.

const normalizeIndianPhone = (input) => {
  if (typeof input !== 'string') {
    return { error: 'PHONE_INVALID' };
  }

  // Strip spaces, dashes, dots, parentheses and a leading double zero
  // (international dialing prefix).
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Accept +91XXXXXXXXXX, 91XXXXXXXXXX, 0XXXXXXXXXX or XXXXXXXXXX
  if (digits.startsWith('+91')) {
    digits = digits.slice(3);
  } else if (digits.startsWith('91') && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1);
  }

  // Indian mobile numbers: exactly 10 digits starting 6-9, digits only.
  if (!/^[6-9]\d{9}$/.test(digits)) {
    return { error: 'PHONE_INVALID' };
  }

  return { phone: `+91${digits}` };
};

const isValidIndianPhone = (input) => !normalizeIndianPhone(input).error;

// +919876543210 -> "+91 98xxxxx210" (keeps first 2 and last 3 subscriber
// digits visible — enough for an admin to recognize a lead, not enough to
// be useful if leaked).
const maskPhone = (phone) => {
  if (typeof phone !== 'string' || phone.length < 10) {
    return '•••';
  }
  const national = phone.replace(/^\+91/, '');
  if (national.length !== 10) {
    return '•••';
  }
  return `+91 ${national.slice(0, 2)}xxxxx${national.slice(-3)}`;
};

module.exports = {
  normalizeIndianPhone,
  isValidIndianPhone,
  maskPhone,
};
