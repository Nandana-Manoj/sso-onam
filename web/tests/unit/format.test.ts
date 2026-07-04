import { describe, expect, it } from 'vitest';
import { toE164, mobileToEmail, formatINR } from '../../src/lib/format';

describe('toE164', () => {
  it('prepends +91 to a bare 10-digit number', () => {
    expect(toE164('9876543210')).toBe('+919876543210');
  });

  it('strips spaces and hyphens before checking the 10-digit form', () => {
    expect(toE164('98765 43210')).toBe('+919876543210');
    expect(toE164('98765-43210')).toBe('+919876543210');
  });

  it('passes through a number that already has a country code', () => {
    expect(toE164('+919876543210')).toBe('+919876543210');
    expect(toE164('+15551234567')).toBe('+15551234567');
  });

  it('trims surrounding whitespace', () => {
    expect(toE164('  9876543210  ')).toBe('+919876543210');
  });

  it('returns non-10-digit, non-+ input unchanged (caller/server validates)', () => {
    expect(toE164('12345')).toBe('12345');
    expect(toE164('abcdefghij')).toBe('abcdefghij');
  });
});

describe('mobileToEmail', () => {
  it('derives a deterministic synthetic email from a bare 10-digit mobile', () => {
    expect(mobileToEmail('9876543210')).toBe('919876543210@phone.sso-onam.com');
  });

  it('derives the same email regardless of +91 prefix or formatting', () => {
    expect(mobileToEmail('+91 98765 43210')).toBe('919876543210@phone.sso-onam.com');
    expect(mobileToEmail('9876543210')).toBe(mobileToEmail('+919876543210'));
  });

  it('strips all non-digit characters from whatever toE164 returns', () => {
    expect(mobileToEmail('+1 (555) 123-4567')).toBe('15551234567@phone.sso-onam.com');
  });
});

describe('formatINR', () => {
  it('formats a whole-rupee amount with the ₹ symbol, no decimals, and Indian grouping', () => {
    expect(formatINR(1000)).toBe('₹1,000');
    expect(formatINR(150000)).toBe('₹1,50,000');
  });

  it('rounds fractional amounts to whole rupees', () => {
    expect(formatINR(999.6)).toBe('₹1,000');
  });

  it('formats zero', () => {
    expect(formatINR(0)).toBe('₹0');
  });
});
