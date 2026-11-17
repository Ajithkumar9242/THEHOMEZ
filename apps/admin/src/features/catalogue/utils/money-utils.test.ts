import { describe, expect, it } from 'vitest';
import {
  formatPaiseToINR,
  paiseToRupeeString,
  parseRupeesToPaise,
  RUPEE_STRING_REGEX,
} from './money-utils.js';

describe('money-utils', () => {
  describe('RUPEE_STRING_REGEX', () => {
    it('accepts whole rupee numbers', () => {
      expect(RUPEE_STRING_REGEX.test('0')).toBe(true);
      expect(RUPEE_STRING_REGEX.test('1')).toBe(true);
      expect(RUPEE_STRING_REGEX.test('380')).toBe(true);
      expect(RUPEE_STRING_REGEX.test('125000')).toBe(true);
    });

    it('accepts rupees with one or two decimal places', () => {
      expect(RUPEE_STRING_REGEX.test('0.5')).toBe(true);
      expect(RUPEE_STRING_REGEX.test('0.50')).toBe(true);
      expect(RUPEE_STRING_REGEX.test('380.5')).toBe(true);
      expect(RUPEE_STRING_REGEX.test('380.50')).toBe(true);
      expect(RUPEE_STRING_REGEX.test('1250.75')).toBe(true);
    });

    it('rejects negative numbers', () => {
      expect(RUPEE_STRING_REGEX.test('-10')).toBe(false);
      expect(RUPEE_STRING_REGEX.test('-0.50')).toBe(false);
    });

    it('rejects numbers with more than two decimal places', () => {
      expect(RUPEE_STRING_REGEX.test('380.555')).toBe(false);
      expect(RUPEE_STRING_REGEX.test('0.001')).toBe(false);
    });

    it('rejects leading zeroes on integer part', () => {
      expect(RUPEE_STRING_REGEX.test('015')).toBe(false);
      expect(RUPEE_STRING_REGEX.test('007.50')).toBe(false);
    });

    it('rejects scientific notation and non-numeric strings', () => {
      expect(RUPEE_STRING_REGEX.test('1e5')).toBe(false);
      expect(RUPEE_STRING_REGEX.test('abc')).toBe(false);
      expect(RUPEE_STRING_REGEX.test('')).toBe(false);
      expect(RUPEE_STRING_REGEX.test('.50')).toBe(false);
    });
  });

  describe('parseRupeesToPaise', () => {
    it('converts whole rupees to integer paise without floating point inaccuracy', () => {
      expect(parseRupeesToPaise('380')).toBe(38000);
      expect(parseRupeesToPaise('0')).toBe(0);
      expect(parseRupeesToPaise('1')).toBe(100);
      expect(parseRupeesToPaise(100)).toBe(10000);
    });

    it('converts decimal rupees with exact padding to paise', () => {
      expect(parseRupeesToPaise('380.5')).toBe(38050);
      expect(parseRupeesToPaise('380.50')).toBe(38050);
      expect(parseRupeesToPaise('1250.75')).toBe(125075);
      expect(parseRupeesToPaise('0.05')).toBe(5);
      expect(parseRupeesToPaise('0.5')).toBe(50);
    });

    it('handles large safe numbers', () => {
      expect(parseRupeesToPaise('90000000.50')).toBe(9000000050);
    });

    it('throws on null, undefined, or empty string', () => {
      expect(() => parseRupeesToPaise(null)).toThrow('Monetary value cannot be empty');
      expect(() => parseRupeesToPaise(undefined)).toThrow('Monetary value cannot be empty');
      expect(() => parseRupeesToPaise('')).toThrow('Monetary value cannot be empty');
      expect(() => parseRupeesToPaise('   ')).toThrow('Monetary value cannot be empty');
    });

    it('throws on invalid decimal formats', () => {
      expect(() => parseRupeesToPaise('10.999')).toThrow(/at most 2 decimal places/);
      expect(() => parseRupeesToPaise('-50')).toThrow(/at most 2 decimal places/);
      expect(() => parseRupeesToPaise('invalid')).toThrow(/at most 2 decimal places/);
    });
  });

  describe('paiseToRupeeString', () => {
    it('converts integer paise into decimal rupee strings for form inputs', () => {
      expect(paiseToRupeeString(38000)).toBe('380.00');
      expect(paiseToRupeeString(38050)).toBe('380.50');
      expect(paiseToRupeeString(125075)).toBe('1250.75');
      expect(paiseToRupeeString(5)).toBe('0.05');
      expect(paiseToRupeeString(0)).toBe('0.00');
    });

    it('returns empty string for null, undefined, or negative values', () => {
      expect(paiseToRupeeString(null)).toBe('');
      expect(paiseToRupeeString(undefined)).toBe('');
      expect(paiseToRupeeString(-100)).toBe('');
      expect(paiseToRupeeString(1.5)).toBe('');
    });
  });

  describe('formatPaiseToINR', () => {
    it('formats integer paise into standard Indian Rupee presentation format', () => {
      expect(formatPaiseToINR(38000)).toBe('₹380.00');
      expect(formatPaiseToINR(38050)).toBe('₹380.50');
      expect(formatPaiseToINR(125075)).toBe('₹1,250.75');
      expect(formatPaiseToINR(10000000)).toBe('₹1,00,000.00');
    });

    it('returns dash placeholder for invalid paise values', () => {
      expect(formatPaiseToINR(null)).toBe('—');
      expect(formatPaiseToINR(undefined)).toBe('—');
      expect(formatPaiseToINR(-1)).toBe('—');
    });
  });
});
