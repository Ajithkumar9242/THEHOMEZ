import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  moneyPaiseSchema,
  canonicalQuantitySchema,
  changeReasonSchema,
  objectIdSchema,
  b2bVolumeTierSchema,
  b2bTiersSchema,
  expectedVersionSchema,
  setPricingSchema,
  setStandalonePricingSchema,
  setVariantPricingSchema,
  standalonePricingParamSchema,
  variantPricingParamSchema,
  pricingIdParamSchema,
  getPricingQuerySchema,
  getPricingHistoryQuerySchema,
  deactivatePricingSchema,
  calculatePriceSchema,
} from '../src/routes/pricing.schemas.js';

describe('Milestone 4 Step 5: Substep 5.5 — Zod Request Validation Schemas', () => {
  const validObjectId = '67a700000000000000000010';
  const validVariantId = '67a700000000000000000020';
  const validServiceAreaId = '67a600000000000000000005';

  // =========================================================================
  // 1. Monetary Values Validation (moneyPaiseSchema)
  // =========================================================================
  describe('Monetary Values Validation (moneyPaiseSchema)', () => {
    it('accepts valid safe integer paise amounts', () => {
      expect(moneyPaiseSchema.parse(0)).toBe(0);
      expect(moneyPaiseSchema.parse(100)).toBe(100);
      expect(moneyPaiseSchema.parse(38050)).toBe(38050);
      expect(moneyPaiseSchema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('rejects negative monetary values', () => {
      expect(() => moneyPaiseSchema.parse(-1)).toThrow(ZodError);
      expect(() => moneyPaiseSchema.parse(-38000)).toThrow(ZodError);
    });

    it('rejects fractional monetary values', () => {
      expect(() => moneyPaiseSchema.parse(380.5)).toThrow(ZodError);
      expect(() => moneyPaiseSchema.parse(0.01)).toThrow(ZodError);
      expect(() => moneyPaiseSchema.parse(100.0001)).toThrow(ZodError);
    });

    it('rejects NaN and Infinite monetary values', () => {
      expect(() => moneyPaiseSchema.parse(NaN)).toThrow(ZodError);
      expect(() => moneyPaiseSchema.parse(Infinity)).toThrow(ZodError);
      expect(() => moneyPaiseSchema.parse(-Infinity)).toThrow(ZodError);
    });

    it('rejects unsafe integer monetary values', () => {
      expect(() => moneyPaiseSchema.parse(Number.MAX_SAFE_INTEGER + 1)).toThrow(ZodError);
      expect(() => moneyPaiseSchema.parse(9007199254740992)).toThrow(ZodError);
    });

    it('rejects non-numeric monetary values', () => {
      expect(() => moneyPaiseSchema.parse('38000')).toThrow(ZodError);
      expect(() => moneyPaiseSchema.parse(null)).toThrow(ZodError);
      expect(() => moneyPaiseSchema.parse(undefined)).toThrow(ZodError);
      expect(() => moneyPaiseSchema.parse(true)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 2. Canonical Decimal Quantity Validation (canonicalQuantitySchema)
  // =========================================================================
  describe('Canonical Decimal Quantity Validation (canonicalQuantitySchema)', () => {
    it('accepts valid canonical decimal strings', () => {
      expect(canonicalQuantitySchema.parse('0')).toBe('0');
      expect(canonicalQuantitySchema.parse('1')).toBe('1');
      expect(canonicalQuantitySchema.parse('0.5')).toBe('0.5');
      expect(canonicalQuantitySchema.parse('100')).toBe('100');
      expect(canonicalQuantitySchema.parse('5.250')).toBe('5.250');
      expect(canonicalQuantitySchema.parse('9999999999.999')).toBe('9999999999.999');
    });

    it('rejects exponent notation in quantities', () => {
      expect(() => canonicalQuantitySchema.parse('1e2')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('1e-3')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('2.5E4')).toThrow(ZodError);
    });

    it('rejects signs in quantities (+ / -)', () => {
      expect(() => canonicalQuantitySchema.parse('+5')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('-5')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('+0.5')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('-0.5')).toThrow(ZodError);
    });

    it('rejects leading zeros on integer part of quantities', () => {
      expect(() => canonicalQuantitySchema.parse('015')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('007')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('00.5')).toThrow(ZodError);
      // But '0' and '0.5' are valid
      expect(canonicalQuantitySchema.parse('0')).toBe('0');
      expect(canonicalQuantitySchema.parse('0.5')).toBe('0.5');
    });

    it('rejects trailing decimal points without fractional digits', () => {
      expect(() => canonicalQuantitySchema.parse('15.')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('0.')).toThrow(ZodError);
    });

    it('rejects empty or whitespace-only quantities', () => {
      expect(() => canonicalQuantitySchema.parse('')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('   ')).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse('\t\n')).toThrow(ZodError);
    });

    it('rejects quantities exceeding maximum string length (15 chars)', () => {
      const sixteenChars = '1234567890123456';
      expect(() => canonicalQuantitySchema.parse(sixteenChars)).toThrow(ZodError);
    });

    it('rejects non-string quantity inputs', () => {
      expect(() => canonicalQuantitySchema.parse(10)).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse(0.5)).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse(null)).toThrow(ZodError);
      expect(() => canonicalQuantitySchema.parse(undefined)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 3. Change Reason Validation (changeReasonSchema)
  // =========================================================================
  describe('Change Reason Validation (changeReasonSchema)', () => {
    it('accepts non-empty meaningful change reasons within 500 characters', () => {
      expect(changeReasonSchema.parse('Quarterly manufacturer price revision')).toBe(
        'Quarterly manufacturer price revision',
      );
      expect(changeReasonSchema.parse('  Trimmed reason  ')).toBe('Trimmed reason');
      expect(changeReasonSchema.parse('A'.repeat(500))).toHaveLength(500);
    });

    it('rejects empty string change reasons', () => {
      expect(() => changeReasonSchema.parse('')).toThrow(ZodError);
    });

    it('rejects whitespace-only change reasons', () => {
      expect(() => changeReasonSchema.parse('   ')).toThrow(ZodError);
      expect(() => changeReasonSchema.parse('\n\t  ')).toThrow(ZodError);
    });

    it('rejects change reasons exceeding 500 characters', () => {
      expect(() => changeReasonSchema.parse('A'.repeat(501))).toThrow(ZodError);
    });

    it('rejects missing or non-string change reasons', () => {
      expect(() => changeReasonSchema.parse(null)).toThrow(ZodError);
      expect(() => changeReasonSchema.parse(undefined)).toThrow(ZodError);
      expect(() => changeReasonSchema.parse(12345)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 4. ObjectId & Identifier Validation
  // =========================================================================
  describe('ObjectId Validation (objectIdSchema)', () => {
    it('accepts valid 24-character hexadecimal MongoDB ObjectIds', () => {
      expect(objectIdSchema.parse(validObjectId)).toBe(validObjectId);
      expect(objectIdSchema.parse('67A700000000000000000010')).toBe('67A700000000000000000010');
    });

    it('rejects malformed ObjectIds', () => {
      expect(() => objectIdSchema.parse('not-an-object-id')).toThrow(ZodError);
      expect(() => objectIdSchema.parse('67a70000000000000000001')).toThrow(ZodError); // 23 chars
      expect(() => objectIdSchema.parse('67a7000000000000000000100')).toThrow(ZodError); // 25 chars
      expect(() => objectIdSchema.parse('67a70000000000000000001Z')).toThrow(ZodError); // invalid hex
    });
  });

  // =========================================================================
  // 5. B2B Volume Tiers Validation (b2bVolumeTierSchema & b2bTiersSchema)
  // =========================================================================
  describe('B2B Volume Tiers Validation', () => {
    it('accepts valid volume tier structure', () => {
      const tier = { minQuantity: '100', pricePaise: 34000 };
      expect(b2bVolumeTierSchema.parse(tier)).toEqual(tier);
    });

    it('rejects unexpected fields in volume tier object (strict)', () => {
      const tierWithExtra = {
        minQuantity: '100',
        pricePaise: 34000,
        discountPercentage: 10, // Unexpected
      };
      expect(() => b2bVolumeTierSchema.parse(tierWithExtra)).toThrow(ZodError);
    });

    it('accepts tier array with up to 10 slabs', () => {
      const tiers = Array.from({ length: 10 }, (_, i) => ({
        minQuantity: `${(i + 1) * 10}`,
        pricePaise: 35000 - i * 100,
      }));
      expect(b2bTiersSchema.parse(tiers)).toHaveLength(10);
    });

    it('rejects tier array exceeding 10 slabs (MAX_B2B_VOLUME_TIERS)', () => {
      const elevenTiers = Array.from({ length: 11 }, (_, i) => ({
        minQuantity: `${(i + 1) * 10}`,
        pricePaise: 35000 - i * 100,
      }));
      expect(() => b2bTiersSchema.parse(elevenTiers)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 6. Concurrency / Version Parameter Validation (expectedVersionSchema)
  // =========================================================================
  describe('Optimistic Concurrency / Version Parameter (expectedVersionSchema)', () => {
    it('accepts valid non-negative integer version values', () => {
      expect(expectedVersionSchema.parse(0)).toBe(0);
      expect(expectedVersionSchema.parse(1)).toBe(1);
      expect(expectedVersionSchema.parse(42)).toBe(42);
    });

    it('rejects negative, fractional, or non-integer version values', () => {
      expect(() => expectedVersionSchema.parse(-1)).toThrow(ZodError);
      expect(() => expectedVersionSchema.parse(1.5)).toThrow(ZodError);
      expect(() => expectedVersionSchema.parse('1')).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 7. Standalone & Variant Set Pricing Schema (setPricingSchema)
  // =========================================================================
  describe('Set / Update Pricing Schema (setPricingSchema)', () => {
    it('accepts a valid standalone global pricing payload', () => {
      const payload = {
        serviceAreaId: null,
        currency: 'INR' as const,
        b2cPricePaise: 38000,
        b2cMrpPaise: 42000,
        b2bPricePaise: 35000,
        b2bTiers: [
          { minQuantity: '20', pricePaise: 34000 },
          { minQuantity: '50', pricePaise: 33000 },
        ],
        allowB2bExceedsB2c: false,
        changeReason: 'Initial standalone global pricing configuration',
      };

      const parsed = setPricingSchema.parse(payload);
      expect(parsed.b2cPricePaise).toBe(38000);
      expect(parsed.serviceAreaId).toBeNull();
      expect(parsed.currency).toBe('INR');
      expect(parsed.b2bTiers).toHaveLength(2);
    });

    it('accepts a valid standalone regional pricing payload', () => {
      const payload = {
        serviceAreaId: validServiceAreaId,
        b2cPricePaise: 41000,
        b2cMrpPaise: 45000,
        b2bPricePaise: 37000,
        b2bTiers: [{ minQuantity: '25', pricePaise: 35500 }],
        changeReason: 'Chennai regional transport cost override',
        expectedVersion: 1,
      };

      const parsed = setPricingSchema.parse(payload);
      expect(parsed.serviceAreaId).toBe(validServiceAreaId);
      expect(parsed.expectedVersion).toBe(1);
    });

    it('accepts a valid variant global pricing payload', () => {
      const payload = {
        serviceAreaId: null,
        b2cPricePaise: 65000,
        b2cMrpPaise: 70000,
        b2bPricePaise: 61000,
        changeReason: '12mm rebar variant baseline pricing',
      };

      const parsed = setPricingSchema.parse(payload);
      expect(parsed.b2cPricePaise).toBe(65000);
      expect(parsed.serviceAreaId).toBeNull();
    });

    it('accepts a valid variant regional pricing payload', () => {
      const payload = {
        serviceAreaId: validServiceAreaId,
        b2cPricePaise: 68000,
        changeReason: '12mm rebar regional override for Chennai',
      };

      const parsed = setPricingSchema.parse(payload);
      expect(parsed.serviceAreaId).toBe(validServiceAreaId);
      expect(parsed.b2cPricePaise).toBe(68000);
    });

    it('strictly rejects unexpected client-supplied fields in setPricingSchema', () => {
      const payloadWithPrivilegedKeys = {
        b2cPricePaise: 38000,
        changeReason: 'Attempting to inject privileged fields',
        customerSegment: 'B2B', // Injected
        status: 'ACTIVE', // Injected
        isActive: true, // Injected
        pricingScope: 'STANDALONE_GLOBAL', // Injected
        productId: validObjectId, // Injected
        variantId: validVariantId, // Injected
        createdBy: validObjectId, // Injected
      };

      expect(() => setPricingSchema.parse(payloadWithPrivilegedKeys)).toThrow(ZodError);
    });

    it('rejects missing b2cPricePaise', () => {
      const payload = {
        changeReason: 'Missing b2c price test',
      };
      expect(() => setPricingSchema.parse(payload)).toThrow(ZodError);
    });

    it('rejects invalid currency codes (strictly INR)', () => {
      const payload = {
        currency: 'USD',
        b2cPricePaise: 38000,
        changeReason: 'Invalid currency test',
      };
      expect(() => setPricingSchema.parse(payload)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 8. Authoritative Calculation Request Schema (calculatePriceSchema)
  // =========================================================================
  describe('Authoritative Calculation Request Schema (calculatePriceSchema)', () => {
    it('accepts valid calculation request with deliveryPincode and standalone product', () => {
      const request = {
        productId: validObjectId,
        deliveryPincode: '600001',
        quantity: '150',
      };

      const parsed = calculatePriceSchema.parse(request);
      expect(parsed.productId).toBe(validObjectId);
      expect(parsed.deliveryPincode).toBe('600001');
      expect(parsed.quantity).toBe('150');
      expect(parsed.variantId).toBeUndefined();
    });

    it('accepts valid calculation request with child variant', () => {
      const request = {
        productId: validObjectId,
        variantId: validVariantId,
        deliveryPincode: '600001',
        quantity: '10',
      };

      const parsed = calculatePriceSchema.parse(request);
      expect(parsed.productId).toBe(validObjectId);
      expect(parsed.variantId).toBe(validVariantId);
    });

    it('accepts calculation request with deliveryPincode omitted or null (global price evaluation)', () => {
      const request1 = {
        productId: validObjectId,
        quantity: '10',
      };
      const request2 = {
        productId: validObjectId,
        deliveryPincode: null,
        quantity: '10',
      };

      expect(calculatePriceSchema.parse(request1).deliveryPincode).toBeUndefined();
      expect(calculatePriceSchema.parse(request2).deliveryPincode).toBeNull();
    });

    it('strictly rejects client-supplied serviceAreaId in calculation request (Zero Client Trust)', () => {
      const requestWithServiceAreaId = {
        productId: validObjectId,
        serviceAreaId: validServiceAreaId, // Strictly forbidden on public calculation
        quantity: '10',
      };

      expect(() => calculatePriceSchema.parse(requestWithServiceAreaId)).toThrow(ZodError);
    });

    it('strictly rejects client-supplied customerSegment, isB2b, or verification status claims', () => {
      const maliciousPayloads = [
        { productId: validObjectId, quantity: '10', customerSegment: 'B2B' },
        { productId: validObjectId, quantity: '10', isB2b: true },
        { productId: validObjectId, quantity: '10', b2bVerificationStatus: 'VERIFIED' },
      ];

      for (const payload of maliciousPayloads) {
        expect(() => calculatePriceSchema.parse(payload)).toThrow(ZodError);
      }
    });

    it('strictly rejects client-supplied unitPrice, discount, or roundingMode overrides', () => {
      const maliciousPayloads = [
        { productId: validObjectId, quantity: '10', unitPrice: 100 },
        { productId: validObjectId, quantity: '10', unitPricePaise: 10000 },
        { productId: validObjectId, quantity: '10', discount: 50 },
        { productId: validObjectId, quantity: '10', roundingMode: 'FLOOR' },
      ];

      for (const payload of maliciousPayloads) {
        expect(() => calculatePriceSchema.parse(payload)).toThrow(ZodError);
      }
    });

    it('rejects invalid Indian delivery postal PIN codes (PINCODE_REGEX)', () => {
      const invalidPincodes = [
        '60000', // 5 digits
        '6000001', // 7 digits
        '060001', // Starting with 0
        '60000A', // Contains letter
        'ABCDEF', // Non-numeric
      ];

      for (const pin of invalidPincodes) {
        expect(() =>
          calculatePriceSchema.parse({
            productId: validObjectId,
            deliveryPincode: pin,
            quantity: '10',
          }),
        ).toThrow(ZodError);
      }
    });

    it('rejects malformed productId or variantId in calculation request', () => {
      expect(() =>
        calculatePriceSchema.parse({
          productId: 'invalid-id',
          quantity: '10',
        }),
      ).toThrow(ZodError);

      expect(() =>
        calculatePriceSchema.parse({
          productId: validObjectId,
          variantId: 'invalid-variant',
          quantity: '10',
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 9. URL Parameters & Query Schemas
  // =========================================================================
  describe('URL Parameters & Query Schemas', () => {
    it('standalonePricingParamSchema accepts valid productId and rejects unexpected keys', () => {
      expect(standalonePricingParamSchema.parse({ id: validObjectId })).toEqual({
        id: validObjectId,
      });
      expect(() => standalonePricingParamSchema.parse({ id: 'bad-id' })).toThrow(ZodError);
      expect(() => standalonePricingParamSchema.parse({ id: validObjectId, extra: 'bad' })).toThrow(
        ZodError,
      );
    });

    it('variantPricingParamSchema accepts valid productId and variantId and rejects unexpected keys', () => {
      expect(
        variantPricingParamSchema.parse({
          productId: validObjectId,
          variantId: validVariantId,
        }),
      ).toEqual({
        productId: validObjectId,
        variantId: validVariantId,
      });

      expect(() =>
        variantPricingParamSchema.parse({
          productId: 'bad-prod',
          variantId: validVariantId,
        }),
      ).toThrow(ZodError);

      expect(() =>
        variantPricingParamSchema.parse({
          productId: validObjectId,
          variantId: 'bad-var',
        }),
      ).toThrow(ZodError);
    });

    it('pricingIdParamSchema accepts valid pricing ID', () => {
      expect(pricingIdParamSchema.parse({ id: validObjectId })).toEqual({ id: validObjectId });
      expect(() => pricingIdParamSchema.parse({ id: 'bad-id' })).toThrow(ZodError);
    });

    it('getPricingQuerySchema accepts optional valid serviceAreaId and rejects unexpected keys', () => {
      expect(getPricingQuerySchema.parse({})).toEqual({});
      expect(getPricingQuerySchema.parse({ serviceAreaId: validServiceAreaId })).toEqual({
        serviceAreaId: validServiceAreaId,
      });
      expect(() => getPricingQuerySchema.parse({ serviceAreaId: 'bad-id' })).toThrow(ZodError);
      expect(() => getPricingQuerySchema.parse({ foreignParam: 'bad' })).toThrow(ZodError);
    });

    it('getPricingHistoryQuerySchema accepts optional variantId, coerces page and limit, and applies defaults', () => {
      const parsedDefault = getPricingHistoryQuerySchema.parse({});
      expect(parsedDefault.page).toBe(1);
      expect(parsedDefault.limit).toBe(20);

      const parsedExplicit = getPricingHistoryQuerySchema.parse({
        variantId: validVariantId,
        page: '2',
        limit: '50',
      });
      expect(parsedExplicit.variantId).toBe(validVariantId);
      expect(parsedExplicit.page).toBe(2);
      expect(parsedExplicit.limit).toBe(50);

      // Rejects negative or 0 page
      expect(() => getPricingHistoryQuerySchema.parse({ page: '0' })).toThrow(ZodError);
      // Rejects limit exceeding 100
      expect(() => getPricingHistoryQuerySchema.parse({ limit: '101' })).toThrow(ZodError);
      // Rejects unexpected keys
      expect(() => getPricingHistoryQuerySchema.parse({ unknownKey: 'xyz' })).toThrow(ZodError);
    });

    it('deactivatePricingSchema accepts valid changeReason and expectedVersion and rejects empty changeReason', () => {
      const valid = {
        changeReason: 'Decommissioning pricing override',
        expectedVersion: 2,
      };
      expect(deactivatePricingSchema.parse(valid)).toEqual(valid);

      expect(() =>
        deactivatePricingSchema.parse({
          changeReason: '',
        }),
      ).toThrow(ZodError);

      expect(() =>
        deactivatePricingSchema.parse({
          changeReason: 'Valid reason',
          extraProperty: 'unexpected',
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 10. Alias Schema Consistency
  // =========================================================================
  describe('Alias Schema Consistency', () => {
    it('setStandalonePricingSchema and setVariantPricingSchema mirror setPricingSchema identically', () => {
      const payload = {
        b2cPricePaise: 50000,
        changeReason: 'Alias consistency check',
      };

      expect(setStandalonePricingSchema.parse(payload)).toEqual(setPricingSchema.parse(payload));
      expect(setVariantPricingSchema.parse(payload)).toEqual(setPricingSchema.parse(payload));
    });
  });
});
