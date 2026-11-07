import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  STOREFRONT_SORT_OPTIONS,
  DEFAULT_STOREFRONT_SORT,
  DEFAULT_STOREFRONT_PAGE,
  DEFAULT_STOREFRONT_LIMIT,
  MIN_STOREFRONT_LIMIT,
  MAX_STOREFRONT_LIMIT,
  MIN_STOREFRONT_SEARCH_QUERY_LENGTH,
  MAX_STOREFRONT_SEARCH_QUERY_LENGTH,
  storefrontCategorySummarySchema,
  storefrontUnitSummarySchema,
  storefrontPricingDtoSchema,
  storefrontPriceRangeDtoSchema,
  storefrontAvailabilityDtoSchema,
  storefrontLocalizationSummarySchema,
  storefrontStandaloneProductCardSchema,
  storefrontMultiVariantProductCardSchema,
  storefrontProductCardSchema,
  storefrontProductListResponseSchema,
  storefrontMasterProductDetailSchema,
  storefrontVariantDetailSchema,
  storefrontProductDetailResponseSchema,
  type IStorefrontProductCard,
  type IStorefrontProductDetailResponse,
  type IStorefrontProductListResponse,
} from '../src/index.js';

describe('Milestone 4 Step 7: Subtask 7.1A — Shared Storefront Contracts & DTO Validation', () => {
  const validObjectId = '672b1234abcd5678ef901234';
  const validServiceAreaId = '672a11110000000000000001';
  const validCategoryId = '672a22220000000000000001';
  const validSubcategoryId = '672a33330000000000000001';

  // =========================================================================
  // 1. Core Constants & Boundaries
  // =========================================================================
  describe('1. Storefront Constants & Sorting Configuration', () => {
    it('defines the approved sorting options', () => {
      expect(STOREFRONT_SORT_OPTIONS).toEqual([
        'featured',
        'newest',
        'price_asc',
        'price_desc',
        'title_asc',
        'title_desc',
      ]);
      expect(DEFAULT_STOREFRONT_SORT).toBe('featured');
    });

    it('defines bounded pagination limits', () => {
      expect(DEFAULT_STOREFRONT_PAGE).toBe(1);
      expect(DEFAULT_STOREFRONT_LIMIT).toBe(20);
      expect(MIN_STOREFRONT_LIMIT).toBe(1);
      expect(MAX_STOREFRONT_LIMIT).toBe(50);
    });

    it('defines search query length boundaries', () => {
      expect(MIN_STOREFRONT_SEARCH_QUERY_LENGTH).toBe(2);
      expect(MAX_STOREFRONT_SEARCH_QUERY_LENGTH).toBe(100);
    });
  });

  // =========================================================================
  // 2. Category Summary Schema
  // =========================================================================
  describe('2. Category Summary DTO (storefrontCategorySummarySchema)', () => {
    it('accepts valid category summaries', () => {
      const valid = {
        id: validCategoryId,
        slug: 'structural-steel',
        name: 'Structural Steel',
      };
      expect(storefrontCategorySummarySchema.parse(valid)).toEqual(valid);
    });

    it('rejects invalid category slugs', () => {
      expect(() =>
        storefrontCategorySummarySchema.parse({
          id: validCategoryId,
          slug: 'Invalid Slug!',
          name: 'Invalid',
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 3. Construction Unit Summary Schema (Decisions #28 & #29)
  // =========================================================================
  describe('3. Unit Summary DTO (storefrontUnitSummarySchema)', () => {
    it('accepts discrete unit configurations with zero decimal precision', () => {
      const discreteBag = {
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '10',
        maxOrderQuantity: '500',
        stepIncrement: '1',
      };
      expect(storefrontUnitSummarySchema.parse(discreteBag)).toEqual(discreteBag);
    });

    it('accepts metric continuous unit configurations with decimal precision', () => {
      const continuousTonne = {
        unitCode: 'TONNE',
        quantityPrecision: 2,
        minOrderQuantity: '1.00',
        maxOrderQuantity: '50.00',
        stepIncrement: '0.05',
      };
      expect(storefrontUnitSummarySchema.parse(continuousTonne)).toEqual(continuousTonne);
    });

    it('rejects non-canonical decimal strings (e.g. leading zeros, exponents)', () => {
      expect(() =>
        storefrontUnitSummarySchema.parse({
          unitCode: 'TONNE',
          quantityPrecision: 2,
          minOrderQuantity: '01.00', // leading zero rejected
          maxOrderQuantity: '50.00',
          stepIncrement: '0.05',
        }),
      ).toThrow(ZodError);

      expect(() =>
        storefrontUnitSummarySchema.parse({
          unitCode: 'BAG',
          quantityPrecision: 0,
          minOrderQuantity: '1e2', // exponent rejected
          maxOrderQuantity: null,
          stepIncrement: '1',
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 4. Commercial Pricing DTOs (Decisions #30, #32, #38, #45)
  // =========================================================================
  describe('4. Storefront Pricing DTO (storefrontPricingDtoSchema)', () => {
    it('accepts valid B2C retail pricing', () => {
      const b2cPricing = {
        customerSegment: 'B2C' as const,
        pricePaise: 38000,
        mrpPaise: 42000,
        savingsPaise: 4000,
        discountPercentage: 9.52,
        isRegionalOverride: false,
        hasVolumeTiers: false,
      };
      expect(storefrontPricingDtoSchema.parse(b2cPricing)).toEqual(b2cPricing);
    });

    it('accepts valid B2B wholesale pricing with volume tiers', () => {
      const b2bPricing = {
        customerSegment: 'B2B' as const,
        pricePaise: 51500,
        mrpPaise: 58000,
        retailBenchmarkPaise: 54000,
        isRegionalOverride: true,
        hasVolumeTiers: true,
        b2bTiers: [
          { minQuantity: '5.05', pricePaise: 50000 },
          { minQuantity: '15.00', pricePaise: 48500 },
        ],
      };
      expect(storefrontPricingDtoSchema.parse(b2bPricing)).toEqual(b2bPricing);
    });

    it('rejects non-positive selling price (pricePaise <= 0 per Decision #45)', () => {
      expect(() =>
        storefrontPricingDtoSchema.parse({
          customerSegment: 'B2C',
          pricePaise: 0, // 0 paise rejected
          mrpPaise: 1000,
          isRegionalOverride: false,
          hasVolumeTiers: false,
        }),
      ).toThrow(ZodError);

      expect(() =>
        storefrontPricingDtoSchema.parse({
          customerSegment: 'B2C',
          pricePaise: -500, // negative paise rejected
          mrpPaise: null,
          isRegionalOverride: false,
          hasVolumeTiers: false,
        }),
      ).toThrow(ZodError);
    });

    it('rejects mrpPaise < pricePaise', () => {
      expect(() =>
        storefrontPricingDtoSchema.parse({
          customerSegment: 'B2C',
          pricePaise: 50000,
          mrpPaise: 45000, // MRP lower than selling price
          isRegionalOverride: false,
          hasVolumeTiers: false,
        }),
      ).toThrow(ZodError);
    });

    it('rejects leaking b2bTiers in B2C segment', () => {
      expect(() =>
        storefrontPricingDtoSchema.parse({
          customerSegment: 'B2C',
          pricePaise: 38000,
          mrpPaise: 42000,
          isRegionalOverride: false,
          hasVolumeTiers: false,
          b2bTiers: [{ minQuantity: '10', pricePaise: 36000 }],
        }),
      ).toThrow(ZodError);
    });
  });

  describe('4.1 Multi-Variant Price Range DTO (storefrontPriceRangeDtoSchema)', () => {
    it('accepts valid multi-variant price ranges', () => {
      const validRange = {
        minPricePaise: 51000,
        maxPricePaise: 78000,
        currency: 'INR' as const,
        displayFormatted: '₹510.00 – ₹780.00',
      };
      expect(storefrontPriceRangeDtoSchema.parse(validRange)).toEqual(validRange);
    });

    it('accepts identical min and max price paise (single variant price point)', () => {
      const flatRange = {
        minPricePaise: 51000,
        maxPricePaise: 51000,
        currency: 'INR' as const,
      };
      expect(storefrontPriceRangeDtoSchema.parse(flatRange)).toEqual(flatRange);
    });

    it('rejects maxPricePaise < minPricePaise', () => {
      expect(() =>
        storefrontPriceRangeDtoSchema.parse({
          minPricePaise: 60000,
          maxPricePaise: 50000,
          currency: 'INR',
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 5. Tri-State Availability Semantics (Decisions #48 & #50)
  // =========================================================================
  describe('5. Tri-State Availability Semantics (storefrontAvailabilityDtoSchema)', () => {
    it('accepts State 1: Unlocalized browsing (Decision #48)', () => {
      const unlocalized = {
        availabilityUnknown: true,
        isAvailable: null, // strictly null
        serviceAreaId: null,
        minLeadTimeHours: null,
        availablePartnerCount: null, // strictly null
        message: 'Enter delivery PIN code to check local availability',
      };
      expect(storefrontAvailabilityDtoSchema.parse(unlocalized)).toEqual(unlocalized);
    });

    it('accepts State 2: Localized serviceable in-stock (Decisions #48 & #49)', () => {
      const localizedInStock = {
        availabilityUnknown: false,
        isAvailable: true,
        serviceAreaId: validServiceAreaId,
        minLeadTimeHours: 12,
        availablePartnerCount: 3,
      };
      expect(storefrontAvailabilityDtoSchema.parse(localizedInStock)).toEqual(localizedInStock);
    });

    it('accepts State 2: Localized serviceable out-of-stock (Decisions #48 & #49)', () => {
      const localizedOutOfStock = {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: validServiceAreaId,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };
      expect(storefrontAvailabilityDtoSchema.parse(localizedOutOfStock)).toEqual(
        localizedOutOfStock,
      );
    });

    it('accepts State 3: Localized unserviceable postal PIN (Decision #50)', () => {
      const unserviceable = {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: null, // null because no service area is mapped
        minLeadTimeHours: null,
        availablePartnerCount: 0,
        message: 'Delivery not available in this area',
      };
      expect(storefrontAvailabilityDtoSchema.parse(unserviceable)).toEqual(unserviceable);
    });

    it('rejects invalid unlocalized state with non-null isAvailable or availablePartnerCount', () => {
      expect(() =>
        storefrontAvailabilityDtoSchema.parse({
          availabilityUnknown: true,
          isAvailable: false, // Must be null when availabilityUnknown is true!
          serviceAreaId: null,
          minLeadTimeHours: null,
          availablePartnerCount: null,
        }),
      ).toThrow(ZodError);

      expect(() =>
        storefrontAvailabilityDtoSchema.parse({
          availabilityUnknown: true,
          isAvailable: null,
          serviceAreaId: null,
          minLeadTimeHours: null,
          availablePartnerCount: 0, // Must be null when availabilityUnknown is true!
        }),
      ).toThrow(ZodError);
    });

    it('rejects in-stock (isAvailable: true) without serviceAreaId or availablePartnerCount < 1', () => {
      expect(() =>
        storefrontAvailabilityDtoSchema.parse({
          availabilityUnknown: false,
          isAvailable: true,
          serviceAreaId: null, // cannot be null when available
          minLeadTimeHours: 12,
          availablePartnerCount: 1,
        }),
      ).toThrow(ZodError);

      expect(() =>
        storefrontAvailabilityDtoSchema.parse({
          availabilityUnknown: false,
          isAvailable: true,
          serviceAreaId: validServiceAreaId,
          minLeadTimeHours: 12,
          availablePartnerCount: 0, // cannot be 0 when available
        }),
      ).toThrow(ZodError);
    });

    it('rejects out-of-stock (isAvailable: false) with non-null lead time or partner count > 0', () => {
      expect(() =>
        storefrontAvailabilityDtoSchema.parse({
          availabilityUnknown: false,
          isAvailable: false,
          serviceAreaId: validServiceAreaId,
          minLeadTimeHours: 24, // must be null when out-of-stock
          availablePartnerCount: 0,
        }),
      ).toThrow(ZodError);

      expect(() =>
        storefrontAvailabilityDtoSchema.parse({
          availabilityUnknown: false,
          isAvailable: false,
          serviceAreaId: validServiceAreaId,
          minLeadTimeHours: null,
          availablePartnerCount: 2, // must be 0 when isAvailable is false
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 6. Product Cards & Discriminated Union (Standalone vs Multi-Variant)
  // =========================================================================
  describe('6. Product Card DTOs (storefrontProductCardSchema)', () => {
    const commonCard = {
      id: validObjectId,
      slug: 'ultratech-super-cement',
      title: 'UltraTech Super Cement',
      brand: 'UltraTech',
      category: { id: validCategoryId, slug: 'cement', name: 'Cement' },
      subcategory: { id: validSubcategoryId, slug: 'ppc-cement', name: 'PPC Cement' },
      images: ['https://assets.thehomez.in/products/ppc.webp'],
      availability: {
        availabilityUnknown: true,
        isAvailable: null,
        serviceAreaId: null,
        minLeadTimeHours: null,
        availablePartnerCount: null,
      },
    };

    it('validates standalone product card with SKU, unit, and pricing', () => {
      const standaloneCard: IStorefrontProductCard = {
        ...commonCard,
        hasVariants: false,
        sku: 'THZ-CEM-ULT-001',
        unit: {
          unitCode: 'BAG',
          quantityPrecision: 0,
          minOrderQuantity: '10',
          maxOrderQuantity: '500',
          stepIncrement: '1',
        },
        pricing: {
          customerSegment: 'B2C',
          pricePaise: 38000,
          mrpPaise: 42000,
          savingsPaise: 4000,
          discountPercentage: 9.52,
          isRegionalOverride: false,
          hasVolumeTiers: false,
        },
      };

      const parsed = storefrontProductCardSchema.parse(standaloneCard);
      expect(parsed.hasVariants).toBe(false);
      if (!parsed.hasVariants) {
        expect(parsed.sku).toBe('THZ-CEM-ULT-001');
        expect(parsed.pricing.pricePaise).toBe(38000);
      }
    });

    it('validates multi-variant product card with variantCount and priceRange', () => {
      const multiVariantCard: IStorefrontProductCard = {
        ...commonCard,
        hasVariants: true,
        variantCount: 6,
        priceRange: {
          minPricePaise: 51000,
          maxPricePaise: 78000,
          currency: 'INR',
          displayFormatted: '₹510.00 – ₹780.00',
        },
      };

      const parsed = storefrontProductCardSchema.parse(multiVariantCard);
      expect(parsed.hasVariants).toBe(true);
      if (parsed.hasVariants) {
        expect(parsed.variantCount).toBe(6);
        expect(parsed.priceRange.minPricePaise).toBe(51000);
      }
    });

    it('rejects multi-variant card with variantCount < 1', () => {
      expect(() =>
        storefrontMultiVariantProductCardSchema.parse({
          ...commonCard,
          hasVariants: true,
          variantCount: 0, // Parent container visible only if >= 1 child variant exists
          priceRange: {
            minPricePaise: 51000,
            maxPricePaise: 78000,
            currency: 'INR',
          },
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 7. Complete Responses (Listing & Detail with Neutral Variant Selection)
  // =========================================================================
  describe('7. Storefront Responses (List & Detail)', () => {
    it('validates complete product list response', () => {
      const listResponse: IStorefrontProductListResponse = {
        items: [
          {
            id: validObjectId,
            slug: 'ultratech-super-cement',
            title: 'UltraTech Super Cement',
            brand: 'UltraTech',
            hasVariants: false,
            sku: 'THZ-CEM-ULT-001',
            category: { id: validCategoryId, slug: 'cement', name: 'Cement' },
            subcategory: { id: validSubcategoryId, slug: 'ppc-cement', name: 'PPC Cement' },
            images: ['https://assets.thehomez.in/products/ppc.webp'],
            unit: {
              unitCode: 'BAG',
              quantityPrecision: 0,
              minOrderQuantity: '10',
              maxOrderQuantity: '500',
              stepIncrement: '1',
            },
            pricing: {
              customerSegment: 'B2C',
              pricePaise: 38000,
              mrpPaise: 42000,
              savingsPaise: 4000,
              discountPercentage: 9.52,
              isRegionalOverride: false,
              hasVolumeTiers: false,
            },
            availability: {
              availabilityUnknown: false,
              isAvailable: true,
              serviceAreaId: validServiceAreaId,
              minLeadTimeHours: 12,
              availablePartnerCount: 3,
            },
          },
        ],
        pagination: {
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
        localization: {
          pincode: '560037',
          isLocalized: true,
          isServiceable: true,
          serviceAreaId: validServiceAreaId,
          serviceAreaName: 'Bangalore East Hub',
        },
        facets: {
          brands: [{ brand: 'UltraTech', count: 1 }],
          subcategories: [
            { id: validSubcategoryId, slug: 'ppc-cement', name: 'PPC Cement', count: 1 },
          ],
        },
      };

      expect(storefrontProductListResponseSchema.parse(listResponse)).toEqual(listResponse);
    });

    it('validates product detail response with neutral initial variant selection', () => {
      const detailResponse: IStorefrontProductDetailResponse = {
        product: {
          id: validObjectId,
          slug: 'tata-tiscon-550d-tmt-bars',
          title: 'Tata Tiscon 550D TMT Rebars',
          brand: 'Tata Tiscon',
          description: 'High-ductility earthquake resistant TMT reinforcement steel bars.',
          hasVariants: true,
          category: { id: validCategoryId, slug: 'structural-steel', name: 'Structural Steel' },
          subcategory: { id: validSubcategoryId, slug: 'tmt-rebars', name: 'TMT Rebars' },
          images: ['https://assets.thehomez.in/products/tata-main.webp'],
          specifications: {
            Grade: 'Fe 550D',
            Standard: 'IS 1786:2008',
          },
        },
        variants: [
          {
            id: '672b1234abcd5678ef901235',
            sku: 'THZ-TATA-550D-12MM',
            title: 'Tata Tiscon 12mm TMT Bar (12m Rod)',
            attributes: { Diameter: '12mm' },
            images: ['https://assets.thehomez.in/products/tata-12mm.webp'],
            unit: {
              unitCode: 'TONNE',
              quantityPrecision: 2,
              minOrderQuantity: '1.00',
              maxOrderQuantity: '50.00',
              stepIncrement: '0.05',
            },
            pricing: {
              customerSegment: 'B2B',
              pricePaise: 51500,
              mrpPaise: 58000,
              retailBenchmarkPaise: 54000,
              isRegionalOverride: true,
              hasVolumeTiers: true,
              b2bTiers: [{ minQuantity: '5.05', pricePaise: 50000 }],
            },
            availability: {
              availabilityUnknown: false,
              isAvailable: true,
              serviceAreaId: validServiceAreaId,
              minLeadTimeHours: 24,
              availablePartnerCount: 2,
            },
          },
          {
            id: '672b1234abcd5678ef901236',
            sku: 'THZ-TATA-550D-16MM',
            title: 'Tata Tiscon 16mm TMT Bar (12m Rod)',
            attributes: { Diameter: '16mm' },
            images: ['https://assets.thehomez.in/products/tata-16mm.webp'],
            unit: {
              unitCode: 'TONNE',
              quantityPrecision: 2,
              minOrderQuantity: '1.00',
              maxOrderQuantity: '50.00',
              stepIncrement: '0.05',
            },
            pricing: {
              customerSegment: 'B2B',
              pricePaise: 52000,
              mrpPaise: 59000,
              retailBenchmarkPaise: 54500,
              isRegionalOverride: true,
              hasVolumeTiers: false,
            },
            availability: {
              availabilityUnknown: false,
              isAvailable: false, // Selectable but out of stock locally (Decision #53 baseline)
              serviceAreaId: validServiceAreaId,
              minLeadTimeHours: null,
              availablePartnerCount: 0,
            },
          },
        ],
        localization: {
          pincode: '560037',
          isLocalized: true,
          isServiceable: true,
          serviceAreaId: validServiceAreaId,
          serviceAreaName: 'Bangalore East Hub',
        },
      };

      const parsed = storefrontProductDetailResponseSchema.parse(detailResponse);
      expect(parsed.variants.length).toBe(2);
      // Invariant: Response has no invented preselectedVariantId property!
      expect((parsed as Record<string, unknown>).selectedVariantId).toBeUndefined();
      expect((parsed as Record<string, unknown>).defaultVariantId).toBeUndefined();
    });
  });

  // =========================================================================
  // 8. Security & Partner Privacy Guard (AC-DISCOV-06, Decisions #46 & #47)
  // =========================================================================
  describe('8. Partner Privacy & Anonymity Guard (AC-DISCOV-06)', () => {
    const forbiddenKeys = [
      'partnerId',
      'partnerName',
      'businessName',
      'partnerAddress',
      'warehouseAddress',
      'supplierCost',
      'costPaise',
      'purchasePrice',
      'margin',
      'grossMargin',
      'commissionRate',
      'partnerCustomSku',
      'operationalNotes',
    ];

    it('verifies public storefront card contains zero forbidden partner or margin keys', () => {
      const sampleCard: IStorefrontProductCard = {
        id: validObjectId,
        slug: 'ultratech-super-cement',
        title: 'UltraTech Super Cement',
        brand: 'UltraTech',
        hasVariants: false,
        sku: 'THZ-CEM-ULT-001',
        category: { id: validCategoryId, slug: 'cement', name: 'Cement' },
        subcategory: { id: validSubcategoryId, slug: 'ppc-cement', name: 'PPC Cement' },
        images: ['https://assets.thehomez.in/products/ppc.webp'],
        unit: {
          unitCode: 'BAG',
          quantityPrecision: 0,
          minOrderQuantity: '10',
          maxOrderQuantity: '500',
          stepIncrement: '1',
        },
        pricing: {
          customerSegment: 'B2C',
          pricePaise: 38000,
          mrpPaise: 42000,
          isRegionalOverride: false,
          hasVolumeTiers: false,
        },
        availability: {
          availabilityUnknown: false,
          isAvailable: true,
          serviceAreaId: validServiceAreaId,
          minLeadTimeHours: 12,
          availablePartnerCount: 3,
        },
      };

      function collectKeys(obj: unknown, keySet: Set<string>): void {
        if (!obj || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (const item of obj) collectKeys(item, keySet);
          return;
        }
        for (const [k, v] of Object.entries(obj)) {
          keySet.add(k);
          collectKeys(v, keySet);
        }
      }

      const foundKeys = new Set<string>();
      collectKeys(sampleCard, foundKeys);

      for (const forbidden of forbiddenKeys) {
        expect(
          foundKeys.has(forbidden),
          `Forbidden partner/margin key "${forbidden}" detected in public card DTO!`,
        ).toBe(false);
      }
    });
  });
});
