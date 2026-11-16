import { describe, it, expect } from 'vitest';
import { PricingValidator, PricingError } from '../src/services/pricing/index.js';
import type { ICreatePricingDto, IQuantityConstraints } from '@thehomez/shared-types';

describe('PricingValidator — Unit Tests', () => {
  const discreteUnitConstraints: IQuantityConstraints = {
    unitCode: 'BAG',
    quantityPrecision: 0,
    minOrderQuantity: '10',
    maxOrderQuantity: '1000',
    stepIncrement: '5',
  };

  const continuousUnitConstraints: IQuantityConstraints = {
    unitCode: 'TONNE',
    quantityPrecision: 2,
    minOrderQuantity: '1.00',
    maxOrderQuantity: '100.00',
    stepIncrement: '0.50',
  };

  describe('1. Monetary Bounds & Safe Integer Validation (assertSafeMoneyPaise)', () => {
    it('accepts valid safe integer paise values', () => {
      expect(() => PricingValidator.assertSafeMoneyPaise(0, 'price')).not.toThrow();
      expect(() => PricingValidator.assertSafeMoneyPaise(38050, 'price')).not.toThrow();
      expect(() =>
        PricingValidator.assertSafeMoneyPaise(Number.MAX_SAFE_INTEGER, 'price'),
      ).not.toThrow();
    });

    it('rejects negative monetary amounts with INVALID_MONEY_PAISE (AC-PRICE-10)', () => {
      expect(() => PricingValidator.assertSafeMoneyPaise(-100, 'price')).toThrowError(PricingError);
      try {
        PricingValidator.assertSafeMoneyPaise(-50, 'price');
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('INVALID_MONEY_PAISE');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('rejects fractional paise amounts with INVALID_MONEY_PAISE (AC-PRICE-09)', () => {
      expect(() => PricingValidator.assertSafeMoneyPaise(380.5, 'price')).toThrowError(
        PricingError,
      );
      expect(() => PricingValidator.assertSafeMoneyPaise(38050.25, 'price')).toThrowError(
        PricingError,
      );
      try {
        PricingValidator.assertSafeMoneyPaise(100.5, 'price');
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('INVALID_MONEY_PAISE');
        } else {
          throw err;
        }
      }
    });

    it('rejects NaN, Infinity, and non-number types with INVALID_MONEY_PAISE', () => {
      expect(() => PricingValidator.assertSafeMoneyPaise(NaN, 'price')).toThrowError(PricingError);
      expect(() => PricingValidator.assertSafeMoneyPaise(Infinity, 'price')).toThrowError(
        PricingError,
      );
      expect(() => PricingValidator.assertSafeMoneyPaise(-Infinity, 'price')).toThrowError(
        PricingError,
      );
      expect(() => PricingValidator.assertSafeMoneyPaise('38000', 'price')).toThrowError(
        PricingError,
      );
      expect(() => PricingValidator.assertSafeMoneyPaise(null, 'price')).toThrowError(PricingError);
    });

    it('rejects numbers exceeding Number.MAX_SAFE_INTEGER (AC-PRICE-11)', () => {
      expect(() =>
        PricingValidator.assertSafeMoneyPaise(Number.MAX_SAFE_INTEGER + 10, 'price'),
      ).toThrowError(PricingError);
    });
  });

  describe('2. MRP Bounds & Pricing Invariants', () => {
    it('accepts valid MRP greater than selling price (AC-PRICE-13)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2cMrpPaise: 42000,
        changeReason: 'Initial catalogue pricing setup',
      };

      expect(() =>
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints),
      ).not.toThrow();
    });

    it('accepts selling price equal to MRP (AC-PRICE-14)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 42000,
        b2cMrpPaise: 42000,
        changeReason: 'Initial setup with zero MRP discount',
      };

      expect(() =>
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints),
      ).not.toThrow();
    });

    it('rejects MRP less than selling price with MRP_LESS_THAN_SELLING_PRICE (AC-PRICE-15)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 45000,
        b2cMrpPaise: 42000,
        changeReason: 'Invalid price entry',
      };

      expect(() =>
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints),
      ).toThrowError(PricingError);

      try {
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints);
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('MRP_LESS_THAN_SELLING_PRICE');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });
  });

  describe('3. B2B Wholesale vs B2C Selling Price Relationship (Decision #35)', () => {
    it('accepts B2B wholesale price lower than B2C (AC-PRICE-16)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        changeReason: 'Standard contractor discount rate',
      };

      expect(() =>
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints),
      ).not.toThrow();
    });

    it('rejects B2B price exceeding B2C without allowB2bExceedsB2c override (AC-PRICE-17)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 40000,
        changeReason: 'Temporary supplier surcharge',
      };

      expect(() =>
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints),
      ).toThrowError(PricingError);

      try {
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints);
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('B2B_PRICE_EXCEEDS_B2C');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('accepts B2B price exceeding B2C with allowB2bExceedsB2c override and changeReason (AC-PRICE-18)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 40000,
        allowB2bExceedsB2c: true,
        changeReason: 'Temporary retail clearance flash sale',
      };

      expect(() =>
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints),
      ).not.toThrow();
    });
  });

  describe('4. B2B Volume Tier Monotonicity & Step Alignment', () => {
    it('rejects volume tiers when b2bPricePaise is omitted (AC-PRICE-19)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: null,
        b2bTiers: [{ minQuantity: '15', pricePaise: 34000 }],
        changeReason: 'Tiers without baseline rate',
      };

      expect(() =>
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints),
      ).toThrowError(PricingError);

      try {
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints);
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('B2B_BASE_PRICE_REQUIRED_FOR_TIERS');
          expect(err.statusCode).toBe(400);
        } else {
          throw err;
        }
      }
    });

    it('rejects Tier 1 price exceeding base B2B price (AC-PRICE-20)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: [{ minQuantity: '15', pricePaise: 36000 }],
        changeReason: 'Tier 1 more expensive than base',
      };

      try {
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints);
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('TIER_MONOTONICITY_VIOLATION');
        } else {
          throw err;
        }
      }
    });

    it('rejects non-increasing tier quantities (AC-PRICE-21)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: [
          { minQuantity: '20', pricePaise: 34000 },
          { minQuantity: '15', pricePaise: 33000 },
        ],
        changeReason: 'Decreasing tier quantity',
      };

      try {
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints);
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('TIER_MONOTONICITY_VIOLATION');
        } else {
          throw err;
        }
      }
    });

    it('rejects equal consecutive tier quantities (AC-PRICE-21)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: [
          { minQuantity: '20', pricePaise: 34000 },
          { minQuantity: '20', pricePaise: 33000 },
        ],
        changeReason: 'Duplicate tier threshold',
      };

      try {
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints);
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('TIER_MONOTONICITY_VIOLATION');
        } else {
          throw err;
        }
      }
    });

    it('rejects increasing tier unit prices (AC-PRICE-22)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: [
          { minQuantity: '20', pricePaise: 34000 },
          { minQuantity: '25', pricePaise: 34500 },
        ],
        changeReason: 'Tier 2 more expensive than Tier 1',
      };

      try {
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints);
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('TIER_MONOTONICITY_VIOLATION');
        } else {
          throw err;
        }
      }
    });

    it('rejects exceeding 10 volume tiers (AC-PRICE-23)', () => {
      const tiers = Array.from({ length: 11 }, (_, i) => ({
        minQuantity: String(15 + i * 5),
        pricePaise: 35000 - i * 100,
      }));

      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: tiers,
        changeReason: '11 tiers submitted',
      };

      try {
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints);
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('MAX_TIERS_EXCEEDED');
        } else {
          throw err;
        }
      }
    });

    it('rejects malformed string quantities in tiers (AC-PRICE-24)', () => {
      const malformedCases = ['-5', '10.0.0', '1234567890123456', '', '   '];
      for (const badQty of malformedCases) {
        const payload: ICreatePricingDto = {
          b2cPricePaise: 38000,
          b2bPricePaise: 35000,
          b2bTiers: [{ minQuantity: badQty, pricePaise: 34000 }],
          changeReason: 'Malformed qty',
        };

        expect(() =>
          PricingValidator.validatePricingPayload(payload, discreteUnitConstraints),
        ).toThrowError(PricingError);
      }
    });

    it('rejects fractional quantity for discrete units (AC-PRICE-25)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: [{ minQuantity: '15.5', pricePaise: 34000 }],
        changeReason: 'Fractional discrete unit',
      };

      try {
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints);
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('TIER_PRECISION_EXCEEDED');
        } else {
          throw err;
        }
      }
    });

    it('rejects decimal precision exceeding unit allowed precision (AC-PRICE-26)', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 6250000,
        b2bPricePaise: 5900000,
        b2bTiers: [{ minQuantity: '5.555', pricePaise: 5750000 }],
        changeReason: 'Precision 3 on precision 2 unit',
      };

      try {
        PricingValidator.validatePricingPayload(payload, continuousUnitConstraints);
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('TIER_PRECISION_EXCEEDED');
        } else {
          throw err;
        }
      }
    });

    it('enforces minimum-anchored step alignment on tiers (AC-PRICE-27)', () => {
      // MOQ = 12, Step = 5
      const customConstraints: IQuantityConstraints = {
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '12',
        maxOrderQuantity: '500',
        stepIncrement: '5',
      };

      // 12 + 5 * 20 = 112 -> VALID
      const validPayload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: [{ minQuantity: '112', pricePaise: 34000 }],
        changeReason: 'Valid step aligned tier',
      };
      expect(() =>
        PricingValidator.validatePricingPayload(validPayload, customConstraints),
      ).not.toThrow();

      // 110 is NOT 12 + 5 * n -> REJECTED
      const invalidPayload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: [{ minQuantity: '110', pricePaise: 34000 }],
        changeReason: 'Misaligned step tier',
      };
      try {
        PricingValidator.validatePricingPayload(invalidPayload, customConstraints);
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('TIER_QUANTITY_STEP_MISMATCH');
        } else {
          throw err;
        }
      }

      // 12 is equal to MOQ -> REJECTED (tier must be strictly > MOQ per Decision #36)
      const moqPayload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: [{ minQuantity: '12', pricePaise: 34000 }],
        changeReason: 'Tier minQuantity equal to MOQ',
      };
      try {
        PricingValidator.validatePricingPayload(moqPayload, customConstraints);
        expect.unreachable();
      } catch (err: unknown) {
        if (err instanceof PricingError) {
          expect(err.code).toBe('TIER_QUANTITY_STEP_MISMATCH');
        } else {
          throw err;
        }
      }
    });
  });

  describe('5. Change Reason Governance (Decision #33)', () => {
    it('rejects empty or whitespace changeReason with VALIDATION_ERROR', () => {
      const emptyPayload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        changeReason: '',
      };
      expect(() =>
        PricingValidator.validatePricingPayload(emptyPayload, discreteUnitConstraints),
      ).toThrowError(PricingError);

      const whitespacePayload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        changeReason: '   ',
      };
      expect(() =>
        PricingValidator.validatePricingPayload(whitespacePayload, discreteUnitConstraints),
      ).toThrowError(PricingError);
    });

    it('rejects changeReason exceeding 500 characters', () => {
      const payload: ICreatePricingDto = {
        b2cPricePaise: 38000,
        changeReason: 'A'.repeat(501),
      };
      expect(() =>
        PricingValidator.validatePricingPayload(payload, discreteUnitConstraints),
      ).toThrowError(PricingError);
    });
  });
});
