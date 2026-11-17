import { describe, expect, it } from 'vitest';
import { validateQuantityInput, validateVolumeTiers, type UnitRules } from './quantity-utils.js';

describe('quantity-utils', () => {
  const discreteUnitRules: UnitRules = {
    unitCode: 'BAG',
    quantityPrecision: 0,
    minOrderQuantity: '10',
    maxOrderQuantity: '1000',
    stepIncrement: '5',
  };

  const continuousUnitRules: UnitRules = {
    unitCode: 'TONNE',
    quantityPrecision: 3,
    minOrderQuantity: '0.500',
    maxOrderQuantity: '50.000',
    stepIncrement: '0.250',
  };

  describe('validateQuantityInput', () => {
    it('validates discrete unit quantities aligning with MOQ and step', () => {
      // MOQ = 10, step = 5 -> valid: 10, 15, 20...
      expect(validateQuantityInput('10', discreteUnitRules).isValid).toBe(true);
      expect(validateQuantityInput('15', discreteUnitRules).isValid).toBe(true);
      expect(validateQuantityInput('25', discreteUnitRules).isValid).toBe(true);
    });

    it('rejects discrete unit quantities with fractional decimals', () => {
      const result = validateQuantityInput('10.5', discreteUnitRules);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/whole integer quantities/);
    });

    it('rejects quantities below MOQ', () => {
      const result = validateQuantityInput('5', discreteUnitRules);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/cannot be less than MOQ/);
    });

    it('rejects quantities not aligned with step increment', () => {
      // 12 is not 10 + n*5
      const result = validateQuantityInput('12', discreteUnitRules);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/MOQ.*Step/);
    });

    it('validates continuous unit quantities respecting 3 decimal places', () => {
      // MOQ = 0.500, step = 0.250 -> valid: 0.500, 0.750, 1.000, 1.250...
      expect(validateQuantityInput('0.500', continuousUnitRules).isValid).toBe(true);
      expect(validateQuantityInput('0.750', continuousUnitRules).isValid).toBe(true);
      expect(validateQuantityInput('1.000', continuousUnitRules).isValid).toBe(true);
      expect(validateQuantityInput('1.25', continuousUnitRules).isValid).toBe(true);
    });

    it('rejects continuous quantities exceeding allowed precision', () => {
      const result = validateQuantityInput('0.5005', continuousUnitRules);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/exceeds the allowed unit precision/);
    });

    it('rejects quantities exceeding maxOrderQuantity', () => {
      const result = validateQuantityInput('55.000', continuousUnitRules);
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/cannot exceed maximum order quantity/);
    });

    it('enforces tier volume quantity must be strictly greater than MOQ', () => {
      // For tiers: minQuantity must be > MOQ
      const resultEqualMoq = validateQuantityInput('10', discreteUnitRules, {
        isTierQuantity: true,
      });
      expect(resultEqualMoq.isValid).toBe(false);
      expect(resultEqualMoq.error).toMatch(/strictly greater than MOQ/);

      const resultGreaterMoq = validateQuantityInput('15', discreteUnitRules, {
        isTierQuantity: true,
      });
      expect(resultGreaterMoq.isValid).toBe(true);
    });
  });

  describe('validateVolumeTiers', () => {
    it('returns valid for empty tiers list', () => {
      expect(validateVolumeTiers([], null, discreteUnitRules).isValid).toBe(true);
    });

    it('rejects tiers if base B2B price is missing', () => {
      const result = validateVolumeTiers(
        [{ minQuantity: '15', pricePaise: 38000 }],
        null,
        discreteUnitRules,
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/Base B2B price is required/);
    });

    it('accepts valid volume tiers with ascending quantity and descending price', () => {
      const result = validateVolumeTiers(
        [
          { minQuantity: '15', pricePaise: 38000 },
          { minQuantity: '50', pricePaise: 36000 },
          { minQuantity: '100', pricePaise: 35000 },
        ],
        40000, // base B2B price
        discreteUnitRules,
      );
      expect(result.isValid).toBe(true);
    });

    it('rejects Tier 1 price exceeding base B2B price', () => {
      const result = validateVolumeTiers(
        [{ minQuantity: '15', pricePaise: 42000 }],
        40000, // base price is 40000, tier 1 is 42000
        discreteUnitRules,
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/Tier 1 unit rate cannot exceed the base wholesale rate/);
    });

    it('rejects tier quantity not strictly increasing', () => {
      const result = validateVolumeTiers(
        [
          { minQuantity: '15', pricePaise: 38000 },
          { minQuantity: '15', pricePaise: 36000 },
        ],
        40000,
        discreteUnitRules,
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/must be strictly greater than Tier 1 quantity/);
    });

    it('rejects tier prices that increase (monotonicity violation)', () => {
      const result = validateVolumeTiers(
        [
          { minQuantity: '15', pricePaise: 38000 },
          { minQuantity: '50', pricePaise: 39000 }, // increased from 38000!
        ],
        40000,
        discreteUnitRules,
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/Tier 2 unit rate cannot exceed Tier 1 unit rate/);
    });

    it('rejects tier quantity that does not align with step formula', () => {
      const result = validateVolumeTiers(
        [{ minQuantity: '17', pricePaise: 38000 }], // 17 is not 10 + n*5
        40000,
        discreteUnitRules,
      );
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/Tier 1.*MOQ.*Step/);
    });
  });
});
