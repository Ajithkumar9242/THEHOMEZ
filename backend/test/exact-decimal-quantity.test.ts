import { describe, it, expect } from 'vitest';
import {
  ExactDecimalQuantity,
  DECIMAL_STRING_REGEX,
  MAX_QUANTITY_STRING_LENGTH,
  type IQuantityConstraints,
} from '@thehomez/shared-types';

describe('Substep 4.1: Exact Decimal Arithmetic & Bounded Quantity Utility', () => {
  describe('Canonical Decimal String Regex', () => {
    it('accepts valid integers and positive decimal strings', () => {
      const valid = ['0', '1', '12', '12.5', '12.50', '0.05', '1000.005', '999999999.999'];
      for (const val of valid) {
        expect(DECIMAL_STRING_REGEX.test(val)).toBe(true);
      }
    });

    it('rejects malformed numbers, exponents, signs, and leading zeros', () => {
      const invalid = [
        '-5',
        '+5',
        '015',
        '00.5',
        '15.',
        '.5',
        '1e2',
        '1.2e3',
        'abc',
        '12.5.5',
        '12,50',
        ' 12 ',
      ];
      for (const val of invalid) {
        expect(DECIMAL_STRING_REGEX.test(val)).toBe(false);
      }
    });
  });

  describe('toScaledBigInt & fromScaledBigInt', () => {
    it('correctly converts canonical strings to scaled BigInts', () => {
      expect(ExactDecimalQuantity.toScaledBigInt('12', 0)).toBe(12n);
      expect(ExactDecimalQuantity.toScaledBigInt('12', 2)).toBe(1200n);
      expect(ExactDecimalQuantity.toScaledBigInt('12.5', 2)).toBe(1250n);
      expect(ExactDecimalQuantity.toScaledBigInt('12.50', 2)).toBe(1250n);
      expect(ExactDecimalQuantity.toScaledBigInt('0.05', 2)).toBe(5n);
      expect(ExactDecimalQuantity.toScaledBigInt('0.005', 3)).toBe(5n);
      expect(ExactDecimalQuantity.toScaledBigInt('1.5', 3)).toBe(1500n);
    });

    it('formats scaled BigInts back to canonical decimal strings', () => {
      expect(ExactDecimalQuantity.fromScaledBigInt(12n, 0)).toBe('12');
      expect(ExactDecimalQuantity.fromScaledBigInt(1200n, 2)).toBe('12.00');
      expect(ExactDecimalQuantity.fromScaledBigInt(1250n, 2)).toBe('12.50');
      expect(ExactDecimalQuantity.fromScaledBigInt(5n, 2)).toBe('0.05');
      expect(ExactDecimalQuantity.fromScaledBigInt(5n, 3)).toBe('0.005');
      expect(ExactDecimalQuantity.fromScaledBigInt(1500n, 3)).toBe('1.500');
    });

    it('rejects strings exceeding maximum allowed string length', () => {
      const longString = '1' + '0'.repeat(MAX_QUANTITY_STRING_LENGTH);
      expect(() => ExactDecimalQuantity.toScaledBigInt(longString, 0)).toThrow(
        'QUANTITY_MALFORMED',
      );
    });

    it('rejects fractional decimals when precision is 0', () => {
      expect(() => ExactDecimalQuantity.toScaledBigInt('12.5', 0)).toThrow(
        'QUANTITY_MUST_BE_INTEGER',
      );
    });

    it('rejects excessive fractional decimals exceeding precision', () => {
      expect(() => ExactDecimalQuantity.toScaledBigInt('12.555', 2)).toThrow(
        'QUANTITY_PRECISION_EXCEEDED',
      );
    });
  });

  describe('Minimum-Anchored Increment Validation', () => {
    const discreteConstraints: IQuantityConstraints = {
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '12',
      maxOrderQuantity: '500',
      stepIncrement: '5',
    };

    it('accepts exact minimum-anchored multiples when MOQ is not a multiple of step', () => {
      // MOQ = 12, Step = 5 -> valid: 12, 17, 22, 27...
      expect(ExactDecimalQuantity.validate('12', discreteConstraints).isValid).toBe(true);
      expect(ExactDecimalQuantity.validate('17', discreteConstraints).isValid).toBe(true);
      expect(ExactDecimalQuantity.validate('22', discreteConstraints).isValid).toBe(true);
      expect(ExactDecimalQuantity.validate('502', discreteConstraints).isValid).toBe(false); // exceeds max 500
      expect(ExactDecimalQuantity.validate('497', discreteConstraints).isValid).toBe(true); // 12 + 5 * 97 = 497
    });

    it('rejects step misalignments that do not anchor to MOQ', () => {
      // 15, 20, 25 are multiples of 5, but NOT (12 + 5n)!
      const res15 = ExactDecimalQuantity.validate('15', discreteConstraints);
      expect(res15.isValid).toBe(false);
      expect(res15.errorCode).toBe('QUANTITY_STEP_INVALID');

      const res20 = ExactDecimalQuantity.validate('20', discreteConstraints);
      expect(res20.isValid).toBe(false);
      expect(res20.errorCode).toBe('QUANTITY_STEP_INVALID');
    });

    it('rejects quantities below MOQ', () => {
      const res = ExactDecimalQuantity.validate('10', discreteConstraints);
      expect(res.isValid).toBe(false);
      expect(res.errorCode).toBe('QUANTITY_BELOW_MINIMUM');
    });

    it('rejects quantities above MaxOQ', () => {
      const res = ExactDecimalQuantity.validate('507', discreteConstraints);
      expect(res.isValid).toBe(false);
      expect(res.errorCode).toBe('QUANTITY_ABOVE_MAXIMUM');
    });

    it('validates continuous decimal materials with minimum-anchored increments', () => {
      const steelConstraints: IQuantityConstraints = {
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '0.50',
        maxOrderQuantity: '25.00',
        stepIncrement: '0.05',
      };

      // 0.50 + 0.05n -> 0.50, 0.55, 0.60, 1.25 are valid
      expect(ExactDecimalQuantity.validate('0.50', steelConstraints).isValid).toBe(true);
      expect(ExactDecimalQuantity.validate('0.55', steelConstraints).isValid).toBe(true);
      expect(ExactDecimalQuantity.validate('0.60', steelConstraints).isValid).toBe(true);
      expect(ExactDecimalQuantity.validate('1.25', steelConstraints).isValid).toBe(true);

      // Misaligned: 0.52
      const resMisaligned = ExactDecimalQuantity.validate('0.52', steelConstraints);
      expect(resMisaligned.isValid).toBe(false);
      expect(resMisaligned.errorCode).toBe('QUANTITY_STEP_INVALID');

      // Excessive precision: 0.505
      const resPrecision = ExactDecimalQuantity.validate('0.505', steelConstraints);
      expect(resPrecision.isValid).toBe(false);
      expect(resPrecision.errorCode).toBe('QUANTITY_PRECISION_EXCEEDED');
    });

    it('handles unbounded MaxOQ gracefully', () => {
      const unbounded: IQuantityConstraints = {
        unitCode: 'METRE',
        quantityPrecision: 1,
        minOrderQuantity: '1.0',
        maxOrderQuantity: null,
        stepIncrement: '0.5',
      };

      expect(ExactDecimalQuantity.validate('1.0', unbounded).isValid).toBe(true);
      expect(ExactDecimalQuantity.validate('1000.5', unbounded).isValid).toBe(true);
    });
  });
});
