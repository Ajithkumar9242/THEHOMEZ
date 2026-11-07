import { describe, it, expect } from 'vitest';
import {
  PermissionCode,
  SYSTEM_ROLE_SEEDS,
  STANDARD_PARTNER_ROLE_PERMISSIONS,
  MIN_LEAD_TIME_HOURS,
  MAX_LEAD_TIME_HOURS,
  DEFAULT_LEAD_TIME_HOURS,
  MIN_BATCH_AVAILABILITY_ITEMS,
  MAX_BATCH_AVAILABILITY_ITEMS,
  MAX_PARTNER_CUSTOM_SKU_LENGTH,
  MAX_AVAILABILITY_REASON_LENGTH,
  createBoundedArray,
  setPartnerAvailabilitySchema,
  togglePartnerAvailabilitySchema,
  batchPartnerAvailabilityRequestSchema,
  publicProductAvailabilityDtoSchema,
  getPartnerAvailabilityQuerySchema,
  type IPublicProductAvailabilityDto,
  type IPartnerProductDto,
  type ISetPartnerProductAvailabilityDto,
  type ITogglePartnerAvailabilityDto,
  type IBatchPartnerAvailabilityRequestDto,
  type IPartnerAvailabilityHistoryDto,
} from '../src/index.js';

describe('Partner Product Availability — Shared Contracts, Permissions & DTOs', () => {
  // ============================================================================
  // 1. Dynamic Permissions (PermissionCode Architecture)
  // ============================================================================
  describe('1. Dynamic Permission Codes (Decision #46)', () => {
    it('defines fine-grained partner availability permissions', () => {
      expect(PermissionCode.PARTNER_AVAILABILITY_READ).toBe('partner_availability:read');
      expect(PermissionCode.PARTNER_AVAILABILITY_WRITE).toBe('partner_availability:write');
    });

    it('ensures permission codes are unique strings across all domain modules', () => {
      const allPermissions = Object.values(PermissionCode);
      const uniquePermissions = new Set(allPermissions);
      expect(uniquePermissions.size).toBe(allPermissions.length);
    });
  });

  // ============================================================================
  // 2. System Role Seeds & RBAC Compatibility (Decision #46)
  // ============================================================================
  describe('2. System Role Seeds & RBAC Compatibility', () => {
    it('grants SUPER_ADMIN both read and write capabilities via Object.values(PermissionCode)', () => {
      const perms = SYSTEM_ROLE_SEEDS.SUPER_ADMIN.permissions;
      expect(perms).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(perms).toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
    });

    it('grants CATALOG_MANAGER both read and write capabilities while preserving existing permissions', () => {
      const perms = SYSTEM_ROLE_SEEDS.CATALOG_MANAGER.permissions;
      expect(perms).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(perms).toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
      // Preserves existing permissions
      expect(perms).toContain(PermissionCode.CATALOG_READ);
      expect(perms).toContain(PermissionCode.CATALOG_WRITE);
      expect(perms).toContain(PermissionCode.CATALOG_PUBLISH);
      expect(perms).toContain(PermissionCode.PRICING_READ);
      expect(perms).toContain(PermissionCode.PRICING_WRITE);
      expect(perms).toContain(PermissionCode.SERVICE_AREA_READ);
      expect(perms).toContain(PermissionCode.SERVICE_AREA_WRITE);
    });

    it('grants PARTNER_MANAGER both read and write capabilities while preserving existing permissions', () => {
      const perms = SYSTEM_ROLE_SEEDS.PARTNER_MANAGER.permissions;
      expect(perms).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(perms).toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
      // Preserves existing permissions
      expect(perms).toContain(PermissionCode.PARTNER_READ);
      expect(perms).toContain(PermissionCode.PARTNER_ONBOARD);
      expect(perms).toContain(PermissionCode.PARTNER_VERIFY);
      expect(perms).toContain(PermissionCode.PARTNER_SUSPEND);
      expect(perms).toContain(PermissionCode.CATALOG_READ);
      expect(perms).toContain(PermissionCode.AUDIT_READ);
      expect(perms).toContain(PermissionCode.SERVICE_AREA_READ);
      expect(perms).toContain(PermissionCode.SERVICE_AREA_WRITE);
    });

    it('grants OPS_MANAGER read-only capability and strictly withholds write capability', () => {
      const perms = SYSTEM_ROLE_SEEDS.OPS_MANAGER.permissions;
      expect(perms).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(perms).not.toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
      // Preserves existing operational permissions
      expect(perms).toContain(PermissionCode.ORDER_READ);
      expect(perms).toContain(PermissionCode.ORDER_CANCEL);
      expect(perms).toContain(PermissionCode.FULFILMENT_UPDATE);
    });

    it('grants SUPPORT read-only capability and strictly withholds write capability', () => {
      const perms = SYSTEM_ROLE_SEEDS.SUPPORT.permissions;
      expect(perms).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(perms).not.toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
      // Preserves existing support permissions
      expect(perms).toContain(PermissionCode.CUSTOMER_READ);
      expect(perms).toContain(PermissionCode.ORDER_READ);
      expect(perms).toContain(PermissionCode.CATALOG_READ);
    });

    it('strictly excludes availability permissions from FINANCE_OFFICER', () => {
      const perms = SYSTEM_ROLE_SEEDS.FINANCE_OFFICER.permissions;
      expect(perms).not.toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(perms).not.toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
      expect(perms).toContain(PermissionCode.FINANCE_READ);
      expect(perms).toContain(PermissionCode.FINANCE_RECONCILE);
    });

    it('defines STANDARD_PARTNER_ROLE_PERMISSIONS with read/write and strictly bars CATALOG_WRITE & CATALOG_PUBLISH', () => {
      expect(STANDARD_PARTNER_ROLE_PERMISSIONS).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(STANDARD_PARTNER_ROLE_PERMISSIONS).toContain(
        PermissionCode.PARTNER_AVAILABILITY_WRITE,
      );
      expect(STANDARD_PARTNER_ROLE_PERMISSIONS).not.toContain(PermissionCode.CATALOG_WRITE);
      expect(STANDARD_PARTNER_ROLE_PERMISSIONS).not.toContain(PermissionCode.CATALOG_PUBLISH);
      expect(STANDARD_PARTNER_ROLE_PERMISSIONS).not.toContain(PermissionCode.PRICING_WRITE);
    });

    it('provisions PARTNER_OPERATOR in SYSTEM_ROLE_SEEDS with UserType.PARTNER and STANDARD_PARTNER_ROLE_PERMISSIONS', () => {
      const partnerSeed = SYSTEM_ROLE_SEEDS.PARTNER_OPERATOR;
      expect(partnerSeed).toBeDefined();
      expect(partnerSeed.code).toBe('PARTNER_OPERATOR');
      expect(partnerSeed.name).toBe('Partner Operator');
      expect(partnerSeed.userType).toBe('PARTNER');
      expect(partnerSeed.isSystemManaged).toBe(true);
      expect(partnerSeed.permissions).toEqual(STANDARD_PARTNER_ROLE_PERMISSIONS);
      expect(partnerSeed.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_READ);
      expect(partnerSeed.permissions).toContain(PermissionCode.PARTNER_AVAILABILITY_WRITE);
      expect(partnerSeed.permissions).not.toContain(PermissionCode.CATALOG_WRITE);
      expect(partnerSeed.permissions).not.toContain(PermissionCode.CATALOG_PUBLISH);
    });
  });

  // ============================================================================
  // 3. Exact Response Semantics (Decision #48)
  // ============================================================================
  describe('3. Public Storefront Availability Semantics (Decision #48)', () => {
    it('validates compliant unlocalized browsing response payload', () => {
      const unlocalizedPayload: IPublicProductAvailabilityDto = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: null,
        isAvailable: null,
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: null,
        message: 'Enter delivery PIN code to check local availability',
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(unlocalizedPayload);
      expect(result.success).toBe(true);
    });

    it('rejects unlocalized payload if isAvailable is falsely set to false or true', () => {
      const invalidPayload = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: null,
        isAvailable: false, // INVALID: must be null
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: null,
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'isAvailable must be strictly null when availabilityUnknown is true',
        );
      }
    });

    it('rejects unlocalized payload if availablePartnerCount is falsely set to 0', () => {
      const invalidPayload = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: null,
        isAvailable: null,
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: 0, // INVALID: must be null
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'availablePartnerCount must be strictly null when availabilityUnknown is true',
        );
      }
    });

    it('rejects unlocalized payload if serviceAreaId is non-null', () => {
      const invalidPayload = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001', // INVALID: must be null
        isAvailable: null,
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: null,
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'serviceAreaId must be strictly null when availabilityUnknown is true',
        );
      }
    });

    it('validates compliant localized in-stock browsing response payload', () => {
      const localizedInStockPayload: IPublicProductAvailabilityDto = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001',
        isAvailable: true,
        availabilityUnknown: false,
        minLeadTimeHours: 4,
        availablePartnerCount: 2,
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(localizedInStockPayload);
      expect(result.success).toBe(true);
    });

    it('validates compliant localized out-of-stock browsing response payload', () => {
      const localizedOutOfStockPayload: IPublicProductAvailabilityDto = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001',
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(localizedOutOfStockPayload);
      expect(result.success).toBe(true);
    });

    it('rejects localized payload if isAvailable is null', () => {
      const invalidPayload = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001',
        isAvailable: null, // INVALID: must be true or false when localized
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'isAvailable must be a boolean (true or false) when availabilityUnknown is false',
        );
      }
    });

    it('validates compliant localized unserviceable PIN browsing response payload (Decision #50)', () => {
      const localizedUnserviceablePayload: IPublicProductAvailabilityDto = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: null, // null for unserviceable PIN outside any service area
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
        message: 'Delivery not available in this area',
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(localizedUnserviceablePayload);
      expect(result.success).toBe(true);
    });

    it('rejects localized in-stock payload when serviceAreaId is null', () => {
      const invalidPayload = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: null, // INVALID: must NOT be null when isAvailable is true
        isAvailable: true,
        availabilityUnknown: false,
        minLeadTimeHours: 4,
        availablePartnerCount: 1,
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'serviceAreaId cannot be null when isAvailable is true',
        );
      }
    });

    it('rejects localized in-stock payload when minLeadTimeHours is null', () => {
      const invalidPayload = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001',
        isAvailable: true,
        availabilityUnknown: false,
        minLeadTimeHours: null, // INVALID: must be integer when isAvailable is true
        availablePartnerCount: 1,
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'minLeadTimeHours cannot be null when isAvailable is true',
        );
      }
    });

    it('rejects localized out-of-stock payload when minLeadTimeHours is not null', () => {
      const invalidPayload = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001',
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: 4, // INVALID: must be null when isAvailable is false
        availablePartnerCount: 0,
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'minLeadTimeHours must be strictly null when isAvailable is false',
        );
      }
    });

    it('rejects localized out-of-stock payload when availablePartnerCount is not 0', () => {
      const invalidPayload = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001',
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 2, // INVALID: must be 0 when isAvailable is false
      };

      const result = publicProductAvailabilityDtoSchema.safeParse(invalidPayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain(
          'availablePartnerCount must be strictly 0 when isAvailable is false',
        );
      }
    });
  });

  // ============================================================================
  // 4. Partner Availability DTO Purity (Zero Price / Money Fields)
  // ============================================================================
  describe('4. Partner Availability DTO Purity (Zero Price / Money Fields)', () => {
    it('verifies IPartnerProductDto structure contains no monetary fields', () => {
      const partnerItem: IPartnerProductDto = {
        id: '672c00000000000000000001',
        partnerId: '672a00000000000000000001',
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001',
        isAvailable: true,
        partnerCustomSku: 'MY-CUSTOM-SKU-001',
        minLeadTimeHours: 6,
        version: 1,
        createdAt: '2026-11-06T10:00:00.000Z',
        updatedAt: '2026-11-06T10:00:00.000Z',
      };

      const keys = Object.keys(partnerItem);
      const prohibitedPricingKeywords = [
        'price',
        'pricepaise',
        'rate',
        'margin',
        'commission',
        'discount',
        'currency',
      ];

      for (const key of keys) {
        for (const kw of prohibitedPricingKeywords) {
          expect(key.toLowerCase()).not.toContain(kw);
        }
      }
    });

    it('verifies ISetPartnerProductAvailabilityDto contains zero pricing fields', () => {
      const setDto: ISetPartnerProductAvailabilityDto = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001',
        isAvailable: true,
        minLeadTimeHours: 12,
      };

      const keys = Object.keys(setDto);
      expect(keys).not.toContain('price');
      expect(keys).not.toContain('pricePaise');
      expect(keys).not.toContain('commissionRate');
    });
  });

  // ============================================================================
  // 5. Concurrency, Lead Time & Operational Boundaries
  // ============================================================================
  describe('5. Operational Boundaries & Concurrency Constants', () => {
    it('enforces lead time constants: 0 to 720 hours (30 days)', () => {
      expect(MIN_LEAD_TIME_HOURS).toBe(0);
      expect(MAX_LEAD_TIME_HOURS).toBe(720);
      expect(DEFAULT_LEAD_TIME_HOURS).toBe(0);
    });

    it('enforces string length and batch limit constants', () => {
      expect(MAX_PARTNER_CUSTOM_SKU_LENGTH).toBe(50);
      expect(MAX_AVAILABILITY_REASON_LENGTH).toBe(200);
      expect(MIN_BATCH_AVAILABILITY_ITEMS).toBe(1);
      expect(MAX_BATCH_AVAILABILITY_ITEMS).toBe(100);
    });

    it('supports version-based optimistic concurrency control tokens', () => {
      const toggleDto: ITogglePartnerAvailabilityDto = {
        isAvailable: false,
        reason: 'Temporary stockout from manufacturer',
        version: 5,
      };
      expect(toggleDto.version).toBe(5);
    });

    it('records immutable audit transition history documents', () => {
      const historyEntry: IPartnerAvailabilityHistoryDto = {
        id: '672d00000000000000000001',
        partnerProductId: '672c00000000000000000001',
        partnerId: '672a00000000000000000001',
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: '672a11110000000000000001',
        previousState: true,
        newState: false,
        reason: 'Yard renovation',
        changedBy: '672e00000000000000000001',
        createdAt: '2026-11-06T10:15:00.000Z',
      };
      expect(historyEntry.previousState).toBe(true);
      expect(historyEntry.newState).toBe(false);
    });
  });

  // ============================================================================
  // 6. createBoundedArray & Zod Schemas Validation
  // ============================================================================
  describe('6. Bounded Array Helper & Zod Validation Schemas', () => {
    it('createBoundedArray enforces min and max length bounds', () => {
      const schema = createBoundedArray(togglePartnerAvailabilitySchema, 1, 3);

      // Valid: 1 item
      expect(schema.safeParse([{ isAvailable: true }]).success).toBe(true);
      // Valid: 3 items
      expect(
        schema.safeParse([{ isAvailable: true }, { isAvailable: false }, { isAvailable: true }])
          .success,
      ).toBe(true);

      // Invalid: 0 items (below min 1)
      expect(schema.safeParse([]).success).toBe(false);

      // Invalid: 4 items (above max 3)
      expect(
        schema.safeParse([
          { isAvailable: true },
          { isAvailable: false },
          { isAvailable: true },
          { isAvailable: false },
        ]).success,
      ).toBe(false);
    });

    it('setPartnerAvailabilitySchema validates correct payload with defaults', () => {
      const parsed = setPartnerAvailabilitySchema.parse({
        productId: '672b00000000000000000010',
        serviceAreaId: '672a11110000000000000001',
      });

      expect(parsed.isAvailable).toBe(true);
      expect(parsed.variantId).toBe(null);
      expect(parsed.minLeadTimeHours).toBe(0);
    });

    it('setPartnerAvailabilitySchema rejects invalid ObjectId or lead time > 720', () => {
      const invalidOid = setPartnerAvailabilitySchema.safeParse({
        productId: 'invalid-id-xyz',
        serviceAreaId: '672a11110000000000000001',
      });
      expect(invalidOid.success).toBe(false);

      const invalidLeadTime = setPartnerAvailabilitySchema.safeParse({
        productId: '672b00000000000000000010',
        serviceAreaId: '672a11110000000000000001',
        minLeadTimeHours: 1000, // Exceeds 720
      });
      expect(invalidLeadTime.success).toBe(false);
    });

    it('togglePartnerAvailabilitySchema validates binary availability with OCC version', () => {
      const parsed = togglePartnerAvailabilitySchema.parse({
        isAvailable: false,
        reason: 'Temporary stock depleted',
        version: 2,
      });
      expect(parsed.isAvailable).toBe(false);
      expect(parsed.version).toBe(2);

      // Rejects reason exceeding 200 characters
      const longReason = 'A'.repeat(201);
      const invalidReason = togglePartnerAvailabilitySchema.safeParse({
        isAvailable: true,
        reason: longReason,
      });
      expect(invalidReason.success).toBe(false);
    });

    it('batchPartnerAvailabilityRequestSchema bounds batch updates between 1 and 100 items', () => {
      const emptyPayload: IBatchPartnerAvailabilityRequestDto = { items: [] };
      expect(batchPartnerAvailabilityRequestSchema.safeParse(emptyPayload).success).toBe(false);

      const validPayload: IBatchPartnerAvailabilityRequestDto = {
        items: [
          {
            id: '672c00000000000000000001',
            isAvailable: true,
            version: 1,
          },
        ],
      };
      expect(batchPartnerAvailabilityRequestSchema.safeParse(validPayload).success).toBe(true);

      const overLimitPayload = {
        items: Array.from({ length: 101 }, (_, i) => ({
          id: '672c00000000000000000001',
          isAvailable: i % 2 === 0,
        })),
      };
      expect(batchPartnerAvailabilityRequestSchema.safeParse(overLimitPayload).success).toBe(false);
    });

    it('getPartnerAvailabilityQuerySchema coerces pagination and parses boolean isAvailable and productId', () => {
      const parsed = getPartnerAvailabilityQuerySchema.parse({
        page: '2',
        limit: '50',
        productId: '672b00000000000000000010',
        isAvailable: 'true',
        search: 'Ultratech Cement',
      });

      expect(parsed.page).toBe(2);
      expect(parsed.limit).toBe(50);
      expect(parsed.productId).toBe('672b00000000000000000010');
      expect(parsed.isAvailable).toBe(true);
      expect(parsed.search).toBe('Ultratech Cement');
    });
  });
});
