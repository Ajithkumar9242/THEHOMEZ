import { describe, it, expect } from 'vitest';
import {
  normalizePhoneNumber,
  isIndianMobileNumber,
  InvalidPhoneError,
} from '../src/services/phone.utils.js';

describe('PhoneUtils — Phone Normalization & Validation', () => {
  describe('Indian Mobile Numbers (+91)', () => {
    it('normalizes standard 10-digit Indian numbers starting with 6, 7, 8, or 9', () => {
      expect(normalizePhoneNumber('9876543210')).toBe('+919876543210');
      expect(normalizePhoneNumber('8765432109')).toBe('+918765432109');
      expect(normalizePhoneNumber('7654321098')).toBe('+917654321098');
      expect(normalizePhoneNumber('6543210987')).toBe('+916543210987');
    });

    it('normalizes 11-digit numbers with leading 0', () => {
      expect(normalizePhoneNumber('09876543210')).toBe('+919876543210');
    });

    it('normalizes formatted and spaced phone strings', () => {
      expect(normalizePhoneNumber('+91 98765 43210')).toBe('+919876543210');
      expect(normalizePhoneNumber('+91-98765-43210')).toBe('+919876543210');
      expect(normalizePhoneNumber('(98765) 43210')).toBe('+919876543210');
      expect(normalizePhoneNumber('+91.98765.43210')).toBe('+919876543210');
    });

    it('normalizes 12-digit Indian numbers starting with 91 without plus', () => {
      expect(normalizePhoneNumber('919876543210')).toBe('+919876543210');
    });

    it('leaves already normalized +91 E.164 numbers intact', () => {
      expect(normalizePhoneNumber('+919876543210')).toBe('+919876543210');
    });

    it('correctly reports isIndianMobileNumber', () => {
      expect(isIndianMobileNumber('+919876543210')).toBe(true);
      expect(isIndianMobileNumber('+915555555555')).toBe(false); // starts with 5
      expect(isIndianMobileNumber('+14155552671')).toBe(false);
    });

    it('rejects Indian mobile numbers starting with invalid digits (1-5)', () => {
      expect(() => normalizePhoneNumber('5555555555')).toThrow(InvalidPhoneError);
      expect(() => normalizePhoneNumber('+911234567890')).toThrow(
        /Invalid Indian mobile number. Must be 10 digits starting with 6, 7, 8, or 9/,
      );
      expect(() => normalizePhoneNumber('+914123456789')).toThrow(
        /Invalid Indian mobile number. Must be 10 digits starting with 6, 7, 8, or 9/,
      );
    });
  });

  describe('International E.164 Numbers', () => {
    it('normalizes and preserves international E.164 numbers without assuming +91', () => {
      expect(normalizePhoneNumber('+14155552671')).toBe('+14155552671');
      expect(normalizePhoneNumber('+447911123456')).toBe('+447911123456');
      expect(normalizePhoneNumber('+6567891234')).toBe('+6567891234');
    });

    it('removes spaces and hyphens from international numbers', () => {
      expect(normalizePhoneNumber('+1 (415) 555-2671')).toBe('+14155552671');
      expect(normalizePhoneNumber('+44 7911 123456')).toBe('+447911123456');
    });
  });

  describe('Invalid and Malformed Phone Formats', () => {
    it('rejects empty or whitespace-only strings', () => {
      expect(() => normalizePhoneNumber('')).toThrow(InvalidPhoneError);
      expect(() => normalizePhoneNumber('   ')).toThrow(InvalidPhoneError);
    });

    it('rejects numbers that are too short or too long', () => {
      expect(() => normalizePhoneNumber('12345')).toThrow(InvalidPhoneError);
      expect(() => normalizePhoneNumber('+9198765432101234567')).toThrow(InvalidPhoneError);
    });

    it('rejects non-numeric alphabetic strings', () => {
      expect(() => normalizePhoneNumber('not-a-number')).toThrow(InvalidPhoneError);
      expect(() => normalizePhoneNumber('+91abc4567890')).toThrow(InvalidPhoneError);
    });
  });
});
