import { describe, it, expect } from 'vitest';
import {
  calculateExactSubtotalPaise,
  calculateSavingsPaise,
  DEFAULT_MONETARY_ROUNDING_MODE,
  type MoneyPaise,
} from '@thehomez/shared-types';

describe('Milestone 4 Step 5: Substep 5.1 — Exact Monetary Rounding & Decision #39', () => {
  it('confirms DEFAULT_MONETARY_ROUNDING_MODE is HALF_UP', () => {
    expect(DEFAULT_MONETARY_ROUNDING_MODE).toBe('HALF_UP');
  });

  describe('1. Exact Integer Subtotal (Zero Fractional Remainder)', () => {
    it('calculates exact subtotal for discrete unit with precision 0', () => {
      // 38000 paise (₹380.00/bag) * 10 bags = 380,000 paise (₹3,800.00)
      const subtotal = calculateExactSubtotalPaise(38000, '10', 0);
      expect(subtotal).toBe(380000);
      expect(Number.isSafeInteger(subtotal)).toBe(true);
    });

    it('calculates exact subtotal for fractional unit when multiplication produces whole paise', () => {
      // 5000 paise (₹50.00/kg) * 2.50 kg (precision 2, scaledQty = 250)
      // 5000 * 250 = 1,250,000 / 100 = 12500 paise (₹125.00)
      const subtotal = calculateExactSubtotalPaise(5000, '2.50', 2);
      expect(subtotal).toBe(12500);
    });
  });

  describe('2. Fraction Below Half a Paise (Rounds Down)', () => {
    it('rounds down when remainder is strictly less than half of the divisor', () => {
      // Unit price: 1001 paise (₹10.01)
      // Quantity: "0.2" with precision 1 (scaledQty = 2, divisor = 10)
      // Raw product: 1001 * 2 = 2002 paise
      // Quotient: 200, Remainder: 2 (which is 0.2 paise, < 0.5 paise)
      // Expected HALF_UP result: 200 paise
      const subtotal = calculateExactSubtotalPaise(1001, '0.2', 1);
      expect(subtotal).toBe(200);
    });

    it('rounds down for precision 3 when fraction is 0.499 paise', () => {
      // Divisor is 1000. Remainder is 499 (0.499 paise, < 0.500 paise).
      // Let unitPrice = 1000499, quantity = "0.001", precision = 3.
      // scaledQty = 1. rawProduct = 1000499.
      // Quotient: 1000, Remainder: 499.
      // Expected: 1000 paise.
      const subtotal = calculateExactSubtotalPaise(1000499, '0.001', 3);
      expect(subtotal).toBe(1000);
    });
  });

  describe('3. Exact Half-Paise Tie (Rounds Upward under Option A)', () => {
    it('rounds 500.5 paise to 501 paise (Decision #39 canonical example)', () => {
      // Example approved in Decision #39:
      // 1001 paise * 0.5 = 500.5 paise, rounded to 501 paise.
      // Unit price: 1001 paise, quantity: "0.5", precision: 1.
      // scaledQty = 5, divisor = 10.
      // rawProduct = 1001 * 5 = 5005.
      // Quotient: 500, Remainder: 5 (exact tie: 5 >= 10 / 2).
      const subtotal = calculateExactSubtotalPaise(1001, '0.5', 1);
      expect(subtotal).toBe(501);
      expect(Number.isSafeInteger(subtotal)).toBe(true);
    });

    it('rounds odd tie upward in commercial HALF_UP mode', () => {
      // 1003 paise * 0.5 = 501.5 paise -> 502 paise
      const subtotal = calculateExactSubtotalPaise(1003, '0.5', 1);
      expect(subtotal).toBe(502);
    });

    it('rounds half-paise tie at precision 3 (remainder = 500 with divisor = 1000)', () => {
      // Unit price: 2000500 paise, quantity: "0.001", precision: 3
      // rawProduct = 2000500. quotient = 2000, remainder = 500.
      // Expected: 2001 paise
      const subtotal = calculateExactSubtotalPaise(2000500, '0.001', 3);
      expect(subtotal).toBe(2001);
    });
  });

  describe('4. Fraction Above Half a Paise (Rounds Upward)', () => {
    it('rounds up when remainder is strictly greater than half the divisor', () => {
      // Unit price: 1001 paise
      // Quantity: "0.7" with precision 1 (scaledQty = 7, divisor = 10)
      // Raw product: 1001 * 7 = 7007
      // Quotient: 700, Remainder: 7 (which is 0.7 paise, > 0.5 paise)
      // Expected: 701 paise
      const subtotal = calculateExactSubtotalPaise(1001, '0.7', 1);
      expect(subtotal).toBe(701);
    });

    it('rounds up for precision 2 with remainder 51 (0.51 paise)', () => {
      // Unit price: 10051, quantity: "0.01", precision: 2
      // rawProduct: 10051 * 1 = 10051. quotient: 100, remainder: 51.
      // Expected: 101 paise
      const subtotal = calculateExactSubtotalPaise(10051, '0.01', 2);
      expect(subtotal).toBe(101);
    });
  });

  describe('5. Zero Quantity Rejection', () => {
    it('rejects "0" with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(38000, '0', 0)).toThrow(RangeError);
      expect(() => calculateExactSubtotalPaise(38000, '0', 0)).toThrow(
        /Quantity must be strictly greater than 0/,
      );
    });

    it('rejects "0.00" with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(38000, '0.00', 2)).toThrow(RangeError);
    });
  });

  describe('6. Negative Quantity Rejection', () => {
    it('rejects "-5" with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(38000, '-5', 0)).toThrow(RangeError);
      expect(() => calculateExactSubtotalPaise(38000, '-5', 0)).toThrow(
        /Quantity cannot be negative/,
      );
    });

    it('rejects "-0.5" with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(1000, '-0.5', 1)).toThrow(RangeError);
    });
  });

  describe('6.1. Unit Price Input Validation & Boundary Enforcement', () => {
    it('accepts zero unit price and returns 0', () => {
      const subtotal = calculateExactSubtotalPaise(0, '10', 0);
      expect(subtotal).toBe(0);
      expect(Number.isSafeInteger(subtotal)).toBe(true);
    });

    it('rejects negative unit price with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(-100 as MoneyPaise, '1', 0)).toThrow(RangeError);
      expect(() => calculateExactSubtotalPaise(-100 as MoneyPaise, '1', 0)).toThrow(
        /unitPricePaise cannot be negative/,
      );
    });

    it('rejects fractional paise unit price with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(100.5 as MoneyPaise, '1', 0)).toThrow(RangeError);
      expect(() => calculateExactSubtotalPaise(100.5 as MoneyPaise, '1', 0)).toThrow(
        /Fractional paise not permitted/,
      );
    });

    it('rejects NaN unit price with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(NaN as MoneyPaise, '1', 0)).toThrow(RangeError);
      expect(() => calculateExactSubtotalPaise(NaN as MoneyPaise, '1', 0)).toThrow(
        /unitPricePaise cannot be NaN/,
      );
    });

    it('rejects Infinity and -Infinity unit price with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(Infinity as MoneyPaise, '1', 0)).toThrow(RangeError);
      expect(() => calculateExactSubtotalPaise(-Infinity as MoneyPaise, '1', 0)).toThrow(
        RangeError,
      );
      expect(() => calculateExactSubtotalPaise(Infinity as MoneyPaise, '1', 0)).toThrow(
        /unitPricePaise must be finite/,
      );
    });

    it('rejects unsafe integer unit price exceeding Number.MAX_SAFE_INTEGER with RangeError', () => {
      const unsafeUnitPrice = Number.MAX_SAFE_INTEGER + 1000;
      expect(() => calculateExactSubtotalPaise(unsafeUnitPrice as MoneyPaise, '1', 0)).toThrow(
        RangeError,
      );
      expect(() => calculateExactSubtotalPaise(unsafeUnitPrice as MoneyPaise, '1', 0)).toThrow(
        /Must be a safe integer/,
      );
    });

    it('rejects non-number unit price inputs with TypeError', () => {
      expect(() => calculateExactSubtotalPaise('100' as unknown as MoneyPaise, '1', 0)).toThrow(
        TypeError,
      );
      expect(() => calculateExactSubtotalPaise(null as unknown as MoneyPaise, '1', 0)).toThrow(
        TypeError,
      );
      expect(() => calculateExactSubtotalPaise(undefined as unknown as MoneyPaise, '1', 0)).toThrow(
        TypeError,
      );
      expect(() => calculateExactSubtotalPaise({} as unknown as MoneyPaise, '1', 0)).toThrow(
        TypeError,
      );
    });
  });

  describe('7. Invalid Precision Rejection', () => {
    it('rejects negative precision with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(1000, '5', -1)).toThrow(RangeError);
    });

    it('rejects precision > 3 with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(1000, '5', 4)).toThrow(RangeError);
    });

    it('rejects fractional precision with RangeError', () => {
      expect(() => calculateExactSubtotalPaise(1000, '5', 1.5)).toThrow(RangeError);
    });
  });

  describe('8. Maximum Safe Integer Boundary & Overflow Rejection', () => {
    it('accepts calculations within Number.MAX_SAFE_INTEGER', () => {
      // 100,000,000 paise (₹10 Lakhs) * 1,000 bags = 100,000,000,000 paise (Safe Integer)
      const subtotal = calculateExactSubtotalPaise(100000000, '1000', 0);
      expect(subtotal).toBe(100000000000);
      expect(Number.isSafeInteger(subtotal)).toBe(true);
    });

    it('rejects overflow beyond Number.MAX_SAFE_INTEGER with RangeError', () => {
      // Number.MAX_SAFE_INTEGER = 9007199254740991
      // If unit price = 9007199254740990 and quantity = "2" -> 18014398509481980 > MAX_SAFE_INTEGER
      expect(() => calculateExactSubtotalPaise(9007199254740990, '2', 0)).toThrow(RangeError);
      expect(() => calculateExactSubtotalPaise(9007199254740990, '2', 0)).toThrow(
        /exceeds Number\.MAX_SAFE_INTEGER/,
      );
    });
  });

  describe('9. Multiple Independently Rounded Line Subtotals (Rule #7)', () => {
    it('sums individually rounded lines without cumulative float drift', () => {
      // Order with 3 line items where each has an exact half-paise:
      // Line 1: 1001 paise * 0.5 kg = 500.5 -> 501 paise
      // Line 2: 1003 paise * 0.5 kg = 501.5 -> 502 paise
      // Line 3: 1005 paise * 0.5 kg = 502.5 -> 503 paise
      const line1 = calculateExactSubtotalPaise(1001, '0.5', 1);
      const line2 = calculateExactSubtotalPaise(1003, '0.5', 1);
      const line3 = calculateExactSubtotalPaise(1005, '0.5', 1);

      expect(line1).toBe(501);
      expect(line2).toBe(502);
      expect(line3).toBe(503);

      const orderTotal = line1 + line2 + line3;
      expect(orderTotal).toBe(1506);
    });
  });

  describe('10. Savings Calculation against MRP (Decision #32)', () => {
    it('returns positive savings when MRP subtotal exceeds selling subtotal', () => {
      const subtotal = 50000; // ₹500
      const mrpSubtotal = 60000; // ₹600
      expect(calculateSavingsPaise(subtotal, mrpSubtotal)).toBe(10000); // ₹100 savings
    });

    it('returns 0 when subtotal equals MRP subtotal', () => {
      expect(calculateSavingsPaise(50000, 50000)).toBe(0);
    });

    it('returns 0 when subtotal exceeds MRP (should not happen in valid catalogue, but safeguard clamped to 0)', () => {
      expect(calculateSavingsPaise(60000, 50000)).toBe(0);
    });

    it('returns null when MRP subtotal is null or undefined', () => {
      expect(calculateSavingsPaise(50000, null)).toBeNull();
      expect(calculateSavingsPaise(50000, undefined)).toBeNull();
    });
  });
});
