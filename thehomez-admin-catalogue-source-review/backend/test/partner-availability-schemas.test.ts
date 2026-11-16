import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  objectIdSchema,
  expectedVersionSchema,
  partnerCustomSkuSchema,
  minLeadTimeHoursSchema,
  availabilityReasonSchema,
  booleanQueryParamSchema,
  setPartnerAvailabilitySchema,
  togglePartnerAvailabilitySchema,
  batchPartnerAvailabilityItemSchema,
  batchPartnerAvailabilityRequestSchema,
  getPartnerAvailabilityQuerySchema,
  partnerAvailabilityIdParamSchema,
  adminPartnerIdParamSchema,
  adminPartnerAvailabilityItemParamSchema,
  getPartnerAvailabilityHistoryQuerySchema,
  publicAvailabilityQuerySchema,
  publicProductAvailabilityDtoSchema,
} from '../src/routes/partner-availability.schemas.js';

describe('Milestone 4 Step 6: Subtask 6.3B — Partner Availability Zod Schemas & Contract Validation', () => {
  const validObjectId = '672b1234abcd5678ef901234';
  const validProductId = '672b00000000000000000010';
  const validVariantId = '672b00000000000000000020';
  const validPartnerId = '672a00000000000000000001';
  const validServiceAreaId = '672a11110000000000000001';
  const validCategoryId = '672a22220000000000000001';

  // =========================================================================
  // 1. ObjectId Schema Validation
  // =========================================================================
  describe('1. ObjectId Validation (objectIdSchema)', () => {
    it('accepts valid 24-character hexadecimal ObjectId strings', () => {
      expect(objectIdSchema.parse(validObjectId)).toBe(validObjectId);
      expect(objectIdSchema.parse('000000000000000000000000')).toBe('000000000000000000000000');
      expect(objectIdSchema.parse('FFFFFFFFFFFFFFFFFFFFFFFF')).toBe('FFFFFFFFFFFFFFFFFFFFFFFF');
    });

    it('trims leading and trailing whitespace on valid ObjectId', () => {
      expect(objectIdSchema.parse(`  ${validObjectId}  `)).toBe(validObjectId);
    });

    it('rejects invalid ObjectId formats', () => {
      expect(() => objectIdSchema.parse('invalid-id')).toThrow(ZodError);
      expect(() => objectIdSchema.parse('672b1234abcd5678ef90123')).toThrow(ZodError); // 23 chars
      expect(() => objectIdSchema.parse('672b1234abcd5678ef9012345')).toThrow(ZodError); // 25 chars
      expect(() => objectIdSchema.parse('672b1234abcd5678ef90123g')).toThrow(ZodError); // non-hex 'g'
      expect(() => objectIdSchema.parse('')).toThrow(ZodError);
      expect(() => objectIdSchema.parse(null)).toThrow(ZodError);
      expect(() => objectIdSchema.parse(undefined)).toThrow(ZodError);
      expect(() => objectIdSchema.parse(12345)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 2. Concurrency Version Schema Validation
  // =========================================================================
  describe('2. Version Validation (expectedVersionSchema)', () => {
    it('accepts valid non-negative safe integers', () => {
      expect(expectedVersionSchema.parse(0)).toBe(0);
      expect(expectedVersionSchema.parse(1)).toBe(1);
      expect(expectedVersionSchema.parse(500)).toBe(500);
      expect(expectedVersionSchema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('rejects negative version numbers', () => {
      expect(() => expectedVersionSchema.parse(-1)).toThrow(ZodError);
      expect(() => expectedVersionSchema.parse(-99)).toThrow(ZodError);
    });

    it('rejects decimal / non-integer version numbers', () => {
      expect(() => expectedVersionSchema.parse(1.5)).toThrow(ZodError);
      expect(() => expectedVersionSchema.parse(0.1)).toThrow(ZodError);
    });

    it('rejects unsafe integer values or NaN', () => {
      expect(() => expectedVersionSchema.parse(Number.MAX_SAFE_INTEGER + 1)).toThrow(ZodError);
      expect(() => expectedVersionSchema.parse(NaN)).toThrow(ZodError);
      expect(() => expectedVersionSchema.parse(Infinity)).toThrow(ZodError);
    });

    it('rejects non-numeric types', () => {
      expect(() => expectedVersionSchema.parse('1')).toThrow(ZodError);
      expect(() => expectedVersionSchema.parse(null)).toThrow(ZodError);
      expect(() => expectedVersionSchema.parse(true)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 3. Partner Custom SKU Schema Validation
  // =========================================================================
  describe('3. Partner Custom SKU Validation (partnerCustomSkuSchema)', () => {
    it('accepts valid custom SKU strings up to 50 characters', () => {
      expect(partnerCustomSkuSchema.parse('WH-BLR-01')).toBe('WH-BLR-01');
      expect(partnerCustomSkuSchema.parse('A')).toBe('A');
      const max50Str = 'A'.repeat(50);
      expect(partnerCustomSkuSchema.parse(max50Str)).toBe(max50Str);
    });

    it('trims whitespace on valid SKU strings', () => {
      expect(partnerCustomSkuSchema.parse('  WH-BLR-01  ')).toBe('WH-BLR-01');
    });

    it('rejects empty or whitespace-only SKU strings', () => {
      expect(() => partnerCustomSkuSchema.parse('')).toThrow(ZodError);
      expect(() => partnerCustomSkuSchema.parse('   ')).toThrow(ZodError);
    });

    it('rejects SKU strings exceeding 50 characters', () => {
      const str51 = 'A'.repeat(51);
      expect(() => partnerCustomSkuSchema.parse(str51)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 4. Min Lead Time Hours Schema Validation
  // =========================================================================
  describe('4. Min Lead Time Hours Validation (minLeadTimeHoursSchema)', () => {
    it('accepts valid integer hours between 0 and 720', () => {
      expect(minLeadTimeHoursSchema.parse(0)).toBe(0);
      expect(minLeadTimeHoursSchema.parse(4)).toBe(4);
      expect(minLeadTimeHoursSchema.parse(24)).toBe(24);
      expect(minLeadTimeHoursSchema.parse(720)).toBe(720);
    });

    it('rejects negative lead time hours', () => {
      expect(() => minLeadTimeHoursSchema.parse(-1)).toThrow(ZodError);
    });

    it('rejects lead time hours exceeding 720 (30 days)', () => {
      expect(() => minLeadTimeHoursSchema.parse(721)).toThrow(ZodError);
      expect(() => minLeadTimeHoursSchema.parse(1000)).toThrow(ZodError);
    });

    it('rejects non-integer / decimal values', () => {
      expect(() => minLeadTimeHoursSchema.parse(4.5)).toThrow(ZodError);
      expect(() => minLeadTimeHoursSchema.parse(0.5)).toThrow(ZodError);
    });

    it('rejects non-numeric types', () => {
      expect(() => minLeadTimeHoursSchema.parse('24')).toThrow(ZodError);
      expect(() => minLeadTimeHoursSchema.parse(null)).toThrow(ZodError);
      expect(() => minLeadTimeHoursSchema.parse(undefined)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 5. Availability Reason Schema Validation
  // =========================================================================
  describe('5. Availability Reason Validation (availabilityReasonSchema)', () => {
    it('accepts valid non-empty reason strings up to 200 characters', () => {
      expect(availabilityReasonSchema.parse('Stock replenished')).toBe('Stock replenished');
      expect(availabilityReasonSchema.parse('A')).toBe('A');
      const max200Str = 'R'.repeat(200);
      expect(availabilityReasonSchema.parse(max200Str)).toBe(max200Str);
    });

    it('trims whitespace on reason strings', () => {
      expect(availabilityReasonSchema.parse('  Warehouse audit done  ')).toBe(
        'Warehouse audit done',
      );
    });

    it('rejects empty or whitespace-only reason strings', () => {
      expect(() => availabilityReasonSchema.parse('')).toThrow(ZodError);
      expect(() => availabilityReasonSchema.parse('    ')).toThrow(ZodError);
    });

    it('rejects reason strings exceeding 200 characters', () => {
      const str201 = 'R'.repeat(201);
      expect(() => availabilityReasonSchema.parse(str201)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 6. Boolean Query Param Schema Validation
  // =========================================================================
  describe('6. Boolean Query Param Validation (booleanQueryParamSchema)', () => {
    it('accepts and preserves raw booleans', () => {
      expect(booleanQueryParamSchema.parse(true)).toBe(true);
      expect(booleanQueryParamSchema.parse(false)).toBe(false);
    });

    it('coerces string "true" and "false" to boolean', () => {
      expect(booleanQueryParamSchema.parse('true')).toBe(true);
      expect(booleanQueryParamSchema.parse('false')).toBe(false);
    });

    it('rejects invalid boolean query representations', () => {
      expect(() => booleanQueryParamSchema.parse('yes')).toThrow(ZodError);
      expect(() => booleanQueryParamSchema.parse('no')).toThrow(ZodError);
      expect(() => booleanQueryParamSchema.parse('1')).toThrow(ZodError);
      expect(() => booleanQueryParamSchema.parse('0')).toThrow(ZodError);
      expect(() => booleanQueryParamSchema.parse('True')).toThrow(ZodError);
      expect(() => booleanQueryParamSchema.parse(null)).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 7. Set / Upsert Partner Availability Body Schema
  // =========================================================================
  describe('7. Set Partner Availability Body Validation (setPartnerAvailabilitySchema)', () => {
    it('accepts valid standalone product availability declaration with all fields', () => {
      const input = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: validServiceAreaId,
        isAvailable: true,
        partnerCustomSku: 'MY-CEM-01',
        minLeadTimeHours: 6,
      };
      const parsed = setPartnerAvailabilitySchema.parse(input);
      expect(parsed).toEqual({
        productId: validProductId,
        variantId: null,
        serviceAreaId: validServiceAreaId,
        isAvailable: true,
        partnerCustomSku: 'MY-CEM-01',
        minLeadTimeHours: 6,
      });
    });

    it('applies default values for optional fields', () => {
      const input = {
        productId: validProductId,
        serviceAreaId: validServiceAreaId,
      };
      const parsed = setPartnerAvailabilitySchema.parse(input);
      expect(parsed.productId).toBe(validProductId);
      expect(parsed.variantId).toBe(null);
      expect(parsed.serviceAreaId).toBe(validServiceAreaId);
      expect(parsed.isAvailable).toBe(true);
      expect(parsed.minLeadTimeHours).toBe(0);
      expect(parsed.partnerCustomSku).toBeUndefined();
    });

    it('accepts valid variant availability declaration', () => {
      const input = {
        productId: validProductId,
        variantId: validVariantId,
        serviceAreaId: validServiceAreaId,
        isAvailable: false,
        minLeadTimeHours: 12,
      };
      const parsed = setPartnerAvailabilitySchema.parse(input);
      expect(parsed.variantId).toBe(validVariantId);
      expect(parsed.isAvailable).toBe(false);
      expect(parsed.minLeadTimeHours).toBe(12);
    });

    it('rejects missing required productId or serviceAreaId', () => {
      expect(() =>
        setPartnerAvailabilitySchema.parse({
          serviceAreaId: validServiceAreaId,
        }),
      ).toThrow(ZodError);

      expect(() =>
        setPartnerAvailabilitySchema.parse({
          productId: validProductId,
        }),
      ).toThrow(ZodError);
    });

    it('strictly rejects unknown client-injected fields (Decision #47 zero client trust)', () => {
      const poisonedPayloads = [
        {
          productId: validProductId,
          serviceAreaId: validServiceAreaId,
          partnerId: validPartnerId, // Forbidden tenant injection
        },
        {
          productId: validProductId,
          serviceAreaId: validServiceAreaId,
          price: 50000, // Forbidden price tampering
        },
        {
          productId: validProductId,
          serviceAreaId: validServiceAreaId,
          discount: 10,
        },
        {
          productId: validProductId,
          serviceAreaId: validServiceAreaId,
          commission: 5,
        },
        {
          productId: validProductId,
          serviceAreaId: validServiceAreaId,
          customerSegment: 'B2B',
        },
        {
          productId: validProductId,
          serviceAreaId: validServiceAreaId,
          status: 'ACTIVE',
        },
      ];

      for (const payload of poisonedPayloads) {
        expect(() => setPartnerAvailabilitySchema.parse(payload)).toThrow(ZodError);
      }
    });
  });

  // =========================================================================
  // 8. Toggle Partner Availability Body Schema
  // =========================================================================
  describe('8. Toggle Partner Availability Validation (togglePartnerAvailabilitySchema)', () => {
    it('accepts minimal valid toggle payload (isAvailable only)', () => {
      const parsed = togglePartnerAvailabilitySchema.parse({
        isAvailable: false,
      });
      expect(parsed).toEqual({ isAvailable: false });
    });

    it('accepts complete toggle payload with reason and optimistic lock version', () => {
      const input = {
        isAvailable: true,
        reason: 'Restocked by regional distributor',
        version: 3,
      };
      const parsed = togglePartnerAvailabilitySchema.parse(input);
      expect(parsed).toEqual(input);
    });

    it('rejects missing isAvailable field', () => {
      expect(() =>
        togglePartnerAvailabilitySchema.parse({
          reason: 'Missing flag',
        }),
      ).toThrow(ZodError);
    });

    it('rejects non-boolean isAvailable values', () => {
      expect(() =>
        togglePartnerAvailabilitySchema.parse({
          isAvailable: 'true',
        }),
      ).toThrow(ZodError);
      expect(() =>
        togglePartnerAvailabilitySchema.parse({
          isAvailable: 1,
        }),
      ).toThrow(ZodError);
    });

    it('strictly rejects extraneous fields in toggle payload', () => {
      expect(() =>
        togglePartnerAvailabilitySchema.parse({
          isAvailable: true,
          partnerId: validPartnerId,
        }),
      ).toThrow(ZodError);

      expect(() =>
        togglePartnerAvailabilitySchema.parse({
          isAvailable: true,
          price: 1000,
        }),
      ).toThrow(ZodError);
    });
  });

  describe('9. Batch Availability Validation', () => {
    describe('batchPartnerAvailabilityItemSchema', () => {
      it('accepts valid minimal item payload', () => {
        const item = { id: validObjectId, isAvailable: true };
        expect(batchPartnerAvailabilityItemSchema.parse(item)).toEqual(item);
      });

      it('accepts valid complete item payload with reason and version', () => {
        const item = {
          id: validObjectId,
          isAvailable: false,
          reason: 'Depleted',
          version: 2,
        };
        expect(batchPartnerAvailabilityItemSchema.parse(item)).toEqual(item);
      });

      it('rejects invalid or missing id', () => {
        expect(() =>
          batchPartnerAvailabilityItemSchema.parse({
            id: 'invalid-id',
            isAvailable: true,
          }),
        ).toThrow(ZodError);

        expect(() =>
          batchPartnerAvailabilityItemSchema.parse({
            isAvailable: true,
          }),
        ).toThrow(ZodError);
      });

      it('rejects missing or non-boolean isAvailable', () => {
        expect(() =>
          batchPartnerAvailabilityItemSchema.parse({
            id: validObjectId,
          }),
        ).toThrow(ZodError);

        expect(() =>
          batchPartnerAvailabilityItemSchema.parse({
            id: validObjectId,
            isAvailable: 'true',
          }),
        ).toThrow(ZodError);
      });

      it('strictly rejects unknown fields on item', () => {
        expect(() =>
          batchPartnerAvailabilityItemSchema.parse({
            id: validObjectId,
            isAvailable: true,
            extra: 'foo',
          }),
        ).toThrow(ZodError);
      });
    });

    describe('batchPartnerAvailabilityRequestSchema', () => {
      it('accepts single-item batch update (minimum boundary = 1)', () => {
        const payload = {
          items: [
            {
              id: validObjectId,
              isAvailable: true,
            },
          ],
        };
        const parsed = batchPartnerAvailabilityRequestSchema.parse(payload);
        expect(parsed.items).toHaveLength(1);
        expect(parsed.items[0]).toEqual({
          id: validObjectId,
          isAvailable: true,
        });
      });

      it('accepts multi-item batch update with reasons and versions', () => {
        const payload = {
          items: [
            {
              id: validObjectId,
              isAvailable: false,
              reason: 'Item depleted',
              version: 1,
            },
            {
              id: '672b1234abcd5678ef901235',
              isAvailable: true,
              reason: 'Restocked',
              version: 2,
            },
          ],
        };
        const parsed = batchPartnerAvailabilityRequestSchema.parse(payload);
        expect(parsed.items).toHaveLength(2);
      });

      it('accepts maximum allowed batch size of 100 items', () => {
        const items = Array.from({ length: 100 }, (_, i) => ({
          id: validObjectId,
          isAvailable: i % 2 === 0,
        }));
        const parsed = batchPartnerAvailabilityRequestSchema.parse({ items });
        expect(parsed.items).toHaveLength(100);
      });

      it('rejects empty items array (0 items < MIN_BATCH_AVAILABILITY_ITEMS)', () => {
        expect(() =>
          batchPartnerAvailabilityRequestSchema.parse({
            items: [],
          }),
        ).toThrow(ZodError);
      });

      it('rejects oversized batch payload (101 items > MAX_BATCH_AVAILABILITY_ITEMS)', () => {
        const items = Array.from({ length: 101 }, () => ({
          id: validObjectId,
          isAvailable: true,
        }));
        expect(() => batchPartnerAvailabilityRequestSchema.parse({ items })).toThrow(ZodError);
      });

      it('rejects batch containing any invalid item', () => {
        const payload = {
          items: [
            { id: validObjectId, isAvailable: true },
            { id: 'invalid-id', isAvailable: false },
          ],
        };
        expect(() => batchPartnerAvailabilityRequestSchema.parse(payload)).toThrow(ZodError);
      });

      it('strictly rejects unknown root fields in batch payload', () => {
        expect(() =>
          batchPartnerAvailabilityRequestSchema.parse({
            items: [{ id: validObjectId, isAvailable: true }],
            partnerId: validPartnerId,
          }),
        ).toThrow(ZodError);
      });
    });
  });

  // =========================================================================
  // 10. Partner Availability Listing Query Schema
  // =========================================================================
  describe('10. Partner Availability Query Validation (getPartnerAvailabilityQuerySchema)', () => {
    it('applies default pagination values when query is empty', () => {
      const parsed = getPartnerAvailabilityQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.limit).toBe(20);
      expect(parsed.serviceAreaId).toBeUndefined();
      expect(parsed.productId).toBeUndefined();
      expect(parsed.isAvailable).toBeUndefined();
      expect(parsed.categoryId).toBeUndefined();
      expect(parsed.search).toBeUndefined();
    });

    it('coerces string page and limit parameters', () => {
      const parsed = getPartnerAvailabilityQuerySchema.parse({
        page: '3',
        limit: '50',
      });
      expect(parsed.page).toBe(3);
      expect(parsed.limit).toBe(50);
    });

    it('transforms isAvailable query string "true" and "false" to booleans', () => {
      expect(getPartnerAvailabilityQuerySchema.parse({ isAvailable: 'true' }).isAvailable).toBe(
        true,
      );
      expect(getPartnerAvailabilityQuerySchema.parse({ isAvailable: 'false' }).isAvailable).toBe(
        false,
      );
    });

    it('accepts filter query parameters', () => {
      const parsed = getPartnerAvailabilityQuerySchema.parse({
        serviceAreaId: validServiceAreaId,
        productId: validProductId,
        categoryId: validCategoryId,
        search: 'UltraTech Cement',
        isAvailable: 'true',
      });
      expect(parsed.serviceAreaId).toBe(validServiceAreaId);
      expect(parsed.productId).toBe(validProductId);
      expect(parsed.categoryId).toBe(validCategoryId);
      expect(parsed.search).toBe('UltraTech Cement');
      expect(parsed.isAvailable).toBe(true);
    });

    it('rejects invalid pagination bounds', () => {
      expect(() => getPartnerAvailabilityQuerySchema.parse({ page: '0' })).toThrow(ZodError);
      expect(() => getPartnerAvailabilityQuerySchema.parse({ page: '-1' })).toThrow(ZodError);
      expect(() => getPartnerAvailabilityQuerySchema.parse({ limit: '0' })).toThrow(ZodError);
      expect(() => getPartnerAvailabilityQuerySchema.parse({ limit: '101' })).toThrow(ZodError);
    });

    it('strictly rejects unknown query parameters', () => {
      expect(() =>
        getPartnerAvailabilityQuerySchema.parse({
          page: '1',
          unknownFilter: 'malicious',
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 11. Route Path Parameter Schemas
  // =========================================================================
  describe('11. Route Path Parameters Validation', () => {
    describe('partnerAvailabilityIdParamSchema', () => {
      it('accepts valid id parameter', () => {
        expect(partnerAvailabilityIdParamSchema.parse({ id: validObjectId })).toEqual({
          id: validObjectId,
        });
      });

      it('rejects invalid id parameter', () => {
        expect(() => partnerAvailabilityIdParamSchema.parse({ id: 'bad-id' })).toThrow(ZodError);
      });

      it('rejects extraneous path parameters', () => {
        expect(() =>
          partnerAvailabilityIdParamSchema.parse({
            id: validObjectId,
            extra: 'abc',
          }),
        ).toThrow(ZodError);
      });
    });

    describe('adminPartnerIdParamSchema', () => {
      it('accepts valid partnerId parameter', () => {
        expect(adminPartnerIdParamSchema.parse({ partnerId: validPartnerId })).toEqual({
          partnerId: validPartnerId,
        });
      });

      it('rejects invalid partnerId parameter', () => {
        expect(() => adminPartnerIdParamSchema.parse({ partnerId: 'not-valid' })).toThrow(ZodError);
      });
    });

    describe('adminPartnerAvailabilityItemParamSchema', () => {
      it('accepts valid partnerId and id parameters', () => {
        expect(
          adminPartnerAvailabilityItemParamSchema.parse({
            partnerId: validPartnerId,
            id: validObjectId,
          }),
        ).toEqual({
          partnerId: validPartnerId,
          id: validObjectId,
        });
      });

      it('rejects when either parameter is invalid', () => {
        expect(() =>
          adminPartnerAvailabilityItemParamSchema.parse({
            partnerId: 'invalid',
            id: validObjectId,
          }),
        ).toThrow(ZodError);

        expect(() =>
          adminPartnerAvailabilityItemParamSchema.parse({
            partnerId: validPartnerId,
            id: 'invalid',
          }),
        ).toThrow(ZodError);
      });
    });
  });

  // =========================================================================
  // 12. History Query Schema
  // =========================================================================
  describe('12. History Query Validation (getPartnerAvailabilityHistoryQuerySchema)', () => {
    it('applies pagination defaults (page 1, limit 20)', () => {
      const parsed = getPartnerAvailabilityHistoryQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.limit).toBe(20);
    });

    it('coerces valid string page and limit', () => {
      const parsed = getPartnerAvailabilityHistoryQuerySchema.parse({
        page: '2',
        limit: '10',
      });
      expect(parsed.page).toBe(2);
      expect(parsed.limit).toBe(10);
    });

    it('rejects out-of-bounds pagination', () => {
      expect(() => getPartnerAvailabilityHistoryQuerySchema.parse({ page: '0' })).toThrow(ZodError);
      expect(() => getPartnerAvailabilityHistoryQuerySchema.parse({ limit: '101' })).toThrow(
        ZodError,
      );
    });

    it('strictly rejects unknown query parameters', () => {
      expect(() =>
        getPartnerAvailabilityHistoryQuerySchema.parse({
          foo: 'bar',
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 13. Public Storefront Availability Query Schema
  // =========================================================================
  describe('13. Public Availability Query Validation (publicAvailabilityQuerySchema)', () => {
    it('accepts empty query (unlocalized discovery)', () => {
      const parsed = publicAvailabilityQuerySchema.parse({});
      expect(parsed).toEqual({});
    });

    it('accepts valid 6-digit Indian PIN code and product/variant IDs', () => {
      const parsed = publicAvailabilityQuerySchema.parse({
        pincode: '560100',
        productId: validProductId,
        variantId: validVariantId,
      });
      expect(parsed.pincode).toBe('560100');
      expect(parsed.productId).toBe(validProductId);
      expect(parsed.variantId).toBe(validVariantId);
    });

    it('accepts variantId as null', () => {
      const parsed = publicAvailabilityQuerySchema.parse({
        pincode: '110001',
        productId: validProductId,
        variantId: null,
      });
      expect(parsed.variantId).toBe(null);
    });

    it('rejects invalid postal PIN codes (non-6 digits, leading zero, letters)', () => {
      expect(() => publicAvailabilityQuerySchema.parse({ pincode: '56010' })).toThrow(ZodError); // 5 digits
      expect(() => publicAvailabilityQuerySchema.parse({ pincode: '5601000' })).toThrow(ZodError); // 7 digits
      expect(() => publicAvailabilityQuerySchema.parse({ pincode: '056010' })).toThrow(ZodError); // leading 0
      expect(() => publicAvailabilityQuerySchema.parse({ pincode: '56010A' })).toThrow(ZodError); // alphanumeric
    });

    it('strictly rejects unknown query parameters', () => {
      expect(() =>
        publicAvailabilityQuerySchema.parse({
          pincode: '560100',
          partnerId: validPartnerId,
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 14. Public Storefront Availability Response DTO Schema (Decision #48)
  // =========================================================================
  describe('14. Public Availability Response DTO Invariants (publicProductAvailabilityDtoSchema)', () => {
    it('accepts valid unlocalized availability DTO (Decision #48: availabilityUnknown = true)', () => {
      const validUnlocalized = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: null,
        isAvailable: null,
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: null,
        message: 'Enter delivery PIN code to check local availability',
      };
      const parsed = publicProductAvailabilityDtoSchema.parse(validUnlocalized);
      expect(parsed).toEqual(validUnlocalized);
    });

    it('rejects unlocalized DTO when isAvailable is not null (falsely claiming in-stock or out-of-stock)', () => {
      const invalid = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: null,
        isAvailable: false, // Must be null when unknown!
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: null,
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalid)).toThrow(ZodError);

      const invalidTrue = {
        ...invalid,
        isAvailable: true,
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalidTrue)).toThrow(ZodError);
    });

    it('rejects unlocalized DTO when serviceAreaId is not null', () => {
      const invalid = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: validServiceAreaId, // Must be null when unknown!
        isAvailable: null,
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: null,
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalid)).toThrow(ZodError);
    });

    it('rejects unlocalized DTO when availablePartnerCount or minLeadTimeHours is not null', () => {
      const invalidCount = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: null,
        isAvailable: null,
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: 0, // Must be null when unknown!
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalidCount)).toThrow(ZodError);

      const invalidLeadTime = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: null,
        isAvailable: null,
        availabilityUnknown: true,
        minLeadTimeHours: 4, // Must be null when unknown!
        availablePartnerCount: null,
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalidLeadTime)).toThrow(ZodError);
    });

    it('accepts valid localized in-stock availability DTO (availabilityUnknown = false)', () => {
      const validLocalizedInStock = {
        productId: validProductId,
        variantId: validVariantId,
        serviceAreaId: validServiceAreaId,
        isAvailable: true,
        availabilityUnknown: false,
        minLeadTimeHours: 6,
        availablePartnerCount: 3,
      };
      const parsed = publicProductAvailabilityDtoSchema.parse(validLocalizedInStock);
      expect(parsed).toEqual(validLocalizedInStock);
    });

    it('accepts valid localized out-of-stock availability DTO (isAvailable = false, count = 0)', () => {
      const validLocalizedOutOfStock = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: validServiceAreaId,
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };
      const parsed = publicProductAvailabilityDtoSchema.parse(validLocalizedOutOfStock);
      expect(parsed).toEqual(validLocalizedOutOfStock);
    });

    it('rejects localized DTO when isAvailable is null', () => {
      const invalid = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: validServiceAreaId,
        isAvailable: null, // Must be boolean when localized!
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalid)).toThrow(ZodError);
    });

    it('rejects localized DTO when serviceAreaId is null and isAvailable is true', () => {
      const invalid = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: null, // Must not be null when isAvailable is true!
        isAvailable: true,
        availabilityUnknown: false,
        minLeadTimeHours: 4,
        availablePartnerCount: 1,
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalid)).toThrow(ZodError);
    });

    it('accepts valid localized unserviceable PIN DTO (Decision #50: isAvailable = false, serviceAreaId = null, count = 0)', () => {
      const validLocalizedUnserviceable = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: null, // null for unserviceable PIN outside any service area
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
        message: 'Delivery not available in this area',
      };
      const parsed = publicProductAvailabilityDtoSchema.parse(validLocalizedUnserviceable);
      expect(parsed).toEqual(validLocalizedUnserviceable);
    });

    it('rejects unserviceable DTO when minLeadTimeHours is not null', () => {
      const invalid = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: null,
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: 6, // Must be null when isAvailable is false
        availablePartnerCount: 0,
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalid)).toThrow(ZodError);
    });

    it('rejects unserviceable DTO when availablePartnerCount is not 0', () => {
      const invalid = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: null,
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 3, // Must be 0 when isAvailable is false
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalid)).toThrow(ZodError);
    });

    it('rejects localized in-stock DTO when minLeadTimeHours is null', () => {
      const invalid = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: validServiceAreaId,
        isAvailable: true,
        availabilityUnknown: false,
        minLeadTimeHours: null, // Must not be null when isAvailable is true
        availablePartnerCount: 1,
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalid)).toThrow(ZodError);
    });

    it('rejects localized DTO when availablePartnerCount is null', () => {
      const invalid = {
        productId: validProductId,
        variantId: null,
        serviceAreaId: validServiceAreaId,
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: null, // Must be integer count!
      };
      expect(() => publicProductAvailabilityDtoSchema.parse(invalid)).toThrow(ZodError);
    });
  });
});
