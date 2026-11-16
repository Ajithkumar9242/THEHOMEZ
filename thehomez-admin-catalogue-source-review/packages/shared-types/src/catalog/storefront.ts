import { z } from 'zod';
import { type MoneyPaise } from '../common/money.js';
import { OBJECT_ID_REGEX, createBoundedArray } from '../common/validation.js';
import { PINCODE_REGEX } from './service-area.js';
import { PRODUCT_SLUG_REGEX } from './product.js';
import { DECIMAL_STRING_REGEX, MAX_QUANTITY_STRING_LENGTH } from './unit-rules.js';
import { type IB2BVolumeTier } from './pricing.js';
import { MIN_LEAD_TIME_HOURS } from './partner-availability.js';

// ============================================================================
// 1. Constants & Boundaries
// ============================================================================

/**
 * Approved storefront sorting options.
 * Defined in Milestone 4 Step 7A Section 9.1 & Step 7B Section 7.1.
 */
export const STOREFRONT_SORT_OPTIONS = [
  'featured',
  'newest',
  'price_asc',
  'price_desc',
  'title_asc',
  'title_desc',
] as const;

export const DEFAULT_STOREFRONT_SORT = 'featured' as const;

/**
 * Pagination boundaries for storefront listings.
 * Enforces strictly bounded results (1 to 50 items) per Decision / AC-DISCOV-18.
 */
export const DEFAULT_STOREFRONT_PAGE = 1;
export const DEFAULT_STOREFRONT_LIMIT = 20;
export const MIN_STOREFRONT_LIMIT = 1;
export const MAX_STOREFRONT_LIMIT = 50;

/**
 * Search query length boundaries (min 2, max 100 characters per Step 7A/7B).
 */
export const MIN_STOREFRONT_SEARCH_QUERY_LENGTH = 2;
export const MAX_STOREFRONT_SEARCH_QUERY_LENGTH = 100;

// ============================================================================
// 2. Types & Enums
// ============================================================================

export type StorefrontSortOption = (typeof STOREFRONT_SORT_OPTIONS)[number];

export type StorefrontCustomerSegment = 'B2C' | 'B2B';

// ============================================================================
// 3. Core Storefront Sub-DTO Interfaces
// ============================================================================

/**
 * Lightweight category summary embedded in storefront product responses.
 */
export interface IStorefrontCategorySummary {
  id: string;
  slug: string;
  name: string;
}

/**
 * Physical construction unit configuration and ordering stepper constraints.
 * Enforces discrete zero-decimal rules vs. metric continuous decimal precision (Decisions #28, #29).
 */
export interface IStorefrontUnitSummary {
  unitCode: string;
  quantityPrecision: number;
  minOrderQuantity: string;
  maxOrderQuantity: string | null;
  stepIncrement: string;
}

/**
 * Authoritative commercial pricing DTO for sellable storefront items.
 *
 * Invariants:
 * - All monetary amounts are non-negative safe integers representing minor units (Paise in INR).
 * - Selling rate (pricePaise) is strictly positive (> 0 paise) per Decision #45.
 * - In B2C context: wholesale b2bTiers and wholesale prices are strictly omitted.
 * - In verified B2B context: wholesale b2bPricePaise and b2bTiers are exposed;
 *   retailBenchmarkPaise provides reference comparison.
 * - Regional overrides completely supersede global pricing (Decisions #31, #38).
 */
export interface IStorefrontStandalonePricingDto {
  customerSegment: StorefrontCustomerSegment;
  pricePaise: MoneyPaise;
  mrpPaise: MoneyPaise | null;
  savingsPaise?: MoneyPaise;
  discountPercentage?: number;
  isRegionalOverride: boolean;
  hasVolumeTiers: boolean;
  retailBenchmarkPaise?: MoneyPaise;
  b2bTiers?: IB2BVolumeTier[];
}

/**
 * Multi-variant container price range DTO.
 * Multi-variant parent products are containers and cannot hold direct single prices (Decision #26).
 */
export interface IStorefrontPriceRangeDto {
  minPricePaise: MoneyPaise;
  maxPricePaise: MoneyPaise;
  currency: 'INR';
  displayFormatted?: string;
}

/**
 * Storefront Localized Availability Resolution DTO.
 *
 * Enforces strict tri-state localization semantics (Decisions #48 & #50):
 * 1. Unlocalized: availabilityUnknown=true, isAvailable=null, serviceAreaId=null,
 *    minLeadTimeHours=null, availablePartnerCount=null.
 * 2. Localized Serviceable: availabilityUnknown=false, isAvailable=true/false,
 *    serviceAreaId=ObjectId string, minLeadTimeHours=min(leadTimes)/null,
 *    availablePartnerCount=count(partners).
 * 3. Localized Unserviceable: availabilityUnknown=false, isAvailable=false,
 *    serviceAreaId=null, minLeadTimeHours=null, availablePartnerCount=0,
 *    message="Delivery not available in this area".
 *
 * Strict Privacy Guard: Zero partner IDs, partner names, warehouse addresses,
 * supplier margins, or cost fields (Decisions #46, #47).
 */
export interface IStorefrontAvailabilityDto {
  availabilityUnknown: boolean;
  isAvailable: boolean | null;
  serviceAreaId: string | null;
  minLeadTimeHours: number | null;
  availablePartnerCount: number | null;
  message?: string;
}

/**
 * Geographical localization summary envelope returned with storefront discovery responses.
 */
export interface IStorefrontLocalizationSummary {
  pincode: string | null;
  isLocalized: boolean;
  isServiceable: boolean;
  serviceAreaId: string | null;
  serviceAreaName: string | null;
}

/**
 * Pagination metadata envelope.
 */
export interface IStorefrontPagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

// ============================================================================
// 4. Facet Aggregation DTOs (Optional Future-Proofing / Step 7B Section 4.2)
// ============================================================================

export interface IStorefrontFacetBrand {
  brand: string;
  count: number;
}

export interface IStorefrontFacetSubcategory {
  id: string;
  slug: string;
  name: string;
  count: number;
}

export interface IStorefrontFacets {
  brands?: IStorefrontFacetBrand[];
  subcategories?: IStorefrontFacetSubcategory[];
}

// ============================================================================
// 5. Storefront Product Card DTOs (PLP & Search Results)
// ============================================================================

/**
 * Base product card properties common to both standalone and multi-variant products.
 */
export interface IStorefrontBaseProductCard {
  id: string;
  slug: string;
  title: string;
  brand: string;
  category: IStorefrontCategorySummary;
  subcategory: IStorefrontCategorySummary;
  images: string[];
  availability: IStorefrontAvailabilityDto;
}

/**
 * Standalone product card: hasVariants is false; holds a single SKU, unit rules, and pricing.
 */
export interface IStorefrontStandaloneProductCard extends IStorefrontBaseProductCard {
  hasVariants: false;
  sku: string | null;
  unit: IStorefrontUnitSummary;
  pricing: IStorefrontStandalonePricingDto;
}

/**
 * Multi-variant container product card: hasVariants is true; cannot hold direct SKU, unit, or single price.
 * Displays variantCount and dynamic price range computed from active priced child variants.
 */
export interface IStorefrontMultiVariantProductCard extends IStorefrontBaseProductCard {
  hasVariants: true;
  variantCount: number;
  priceRange: IStorefrontPriceRangeDto;
}

/**
 * Discriminated union of sellable storefront product cards.
 */
export type IStorefrontProductCard =
  IStorefrontStandaloneProductCard | IStorefrontMultiVariantProductCard;

/**
 * Complete Product Listing Response Payload (GET /api/v1/storefront/products & /search).
 */
export interface IStorefrontProductListResponse {
  items: IStorefrontProductCard[];
  pagination: IStorefrontPagination;
  localization: IStorefrontLocalizationSummary;
  facets?: IStorefrontFacets;
}

// ============================================================================
// 6. Storefront Product Detail DTOs (PDP: GET /api/v1/storefront/products/:slug)
// ============================================================================

/**
 * Master product detail specification on PDP.
 */
export interface IStorefrontMasterProductDetail {
  id: string;
  slug: string;
  title: string;
  brand: string;
  description?: string;
  hasVariants: boolean;
  sku?: string | null;
  category: IStorefrontCategorySummary;
  subcategory: IStorefrontCategorySummary;
  images: string[];
  specifications: Record<string, string>;
  unit?: IStorefrontUnitSummary;
  pricing?: IStorefrontStandalonePricingDto;
  availability?: IStorefrontAvailabilityDto;
}

/**
 * Individual selectable child variant detail on PDP.
 *
 * In accordance with neutral initial variant selection (Decision #53 pending / baseline):
 * Variants are presented in neutral state without a preselected variant invented by the API.
 */
export interface IStorefrontVariantDetail {
  id: string;
  sku: string;
  title: string;
  attributes: Record<string, string>;
  images: string[];
  unit: IStorefrontUnitSummary;
  pricing: IStorefrontStandalonePricingDto;
  availability: IStorefrontAvailabilityDto;
}

/**
 * Complete Product Detail Response Payload (GET /api/v1/storefront/products/:slug).
 */
export interface IStorefrontProductDetailResponse {
  product: IStorefrontMasterProductDetail;
  variants: IStorefrontVariantDetail[];
  localization: IStorefrontLocalizationSummary;
}

// ============================================================================
// 7. Storefront Request Query & Parameter Contracts
// ============================================================================

/**
 * Query parameters contract for GET /api/v1/storefront/products
 */
export interface IStorefrontProductQuery {
  page?: number;
  limit?: number;
  category?: string;
  subcategory?: string;
  brand?: string;
  pincode?: string;
  minPricePaise?: MoneyPaise;
  maxPricePaise?: MoneyPaise;
  inStockOnly?: boolean;
  sort?: StorefrontSortOption;
  includeFacets?: boolean;
}

/**
 * Path parameter contract for GET /api/v1/storefront/products/:slug
 */
export interface IStorefrontProductSlugParam {
  slug: string;
}

/**
 * Query parameter contract for GET /api/v1/storefront/products/:slug
 */
export interface IStorefrontProductDetailQuery {
  pincode?: string;
}

/**
 * Query parameters contract for GET /api/v1/storefront/search
 */
export interface IStorefrontSearchQuery {
  q: string;
  page?: number;
  limit?: number;
  category?: string;
  subcategory?: string;
  brand?: string;
  pincode?: string;
  minPricePaise?: MoneyPaise;
  maxPricePaise?: MoneyPaise;
  inStockOnly?: boolean;
  sort?: StorefrontSortOption;
  includeFacets?: boolean;
}

// ============================================================================
// 8. Shared Zod Schemas for Storefront DTO Contracts
// ============================================================================

export const storefrontObjectIdSchema = z
  .string()
  .trim()
  .regex(OBJECT_ID_REGEX, 'Invalid ObjectId format');

export const storefrontCategorySummarySchema = z.object({
  id: storefrontObjectIdSchema,
  slug: z.string().trim().regex(PRODUCT_SLUG_REGEX, 'Invalid category slug format'),
  name: z.string().trim().min(1, 'Category name cannot be empty'),
});

export const storefrontUnitSummarySchema = z.object({
  unitCode: z.string().trim().min(1, 'unitCode is required'),
  quantityPrecision: z.number().int().min(0).max(3),
  minOrderQuantity: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'minOrderQuantity must be canonical decimal')
    .max(MAX_QUANTITY_STRING_LENGTH),
  maxOrderQuantity: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'maxOrderQuantity must be canonical decimal')
    .max(MAX_QUANTITY_STRING_LENGTH)
    .nullable(),
  stepIncrement: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'stepIncrement must be canonical decimal')
    .max(MAX_QUANTITY_STRING_LENGTH),
});

export const storefrontVolumeTierSchema = z.object({
  minQuantity: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'minQuantity must be canonical decimal')
    .max(MAX_QUANTITY_STRING_LENGTH),
  pricePaise: z.number().int().min(0),
});

export const storefrontPricingDtoSchema = z
  .object({
    customerSegment: z.enum(['B2C', 'B2B']),
    pricePaise: z.number().int().positive('pricePaise must be strictly positive (> 0 paise)'),
    mrpPaise: z.number().int().min(0).nullable(),
    savingsPaise: z.number().int().min(0).optional(),
    discountPercentage: z.number().min(0).max(100).optional(),
    isRegionalOverride: z.boolean(),
    hasVolumeTiers: z.boolean(),
    retailBenchmarkPaise: z.number().int().min(0).optional(),
    b2bTiers: createBoundedArray(storefrontVolumeTierSchema, 0, 10).optional(),
  })
  .superRefine((val, ctx) => {
    // If MRP is defined, it must be >= pricePaise
    if (val.mrpPaise !== null && val.mrpPaise < val.pricePaise) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mrpPaise'],
        message: 'mrpPaise must be greater than or equal to pricePaise',
      });
    }
    // In B2C context, B2B volume tiers must not be leaked
    if (val.customerSegment === 'B2C' && val.b2bTiers && val.b2bTiers.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['b2bTiers'],
        message: 'b2bTiers must not be exposed in B2C customer segment',
      });
    }
  });

export const storefrontPriceRangeDtoSchema = z
  .object({
    minPricePaise: z.number().int().positive('minPricePaise must be strictly positive'),
    maxPricePaise: z.number().int().positive('maxPricePaise must be strictly positive'),
    currency: z.literal('INR'),
    displayFormatted: z.string().optional(),
  })
  .refine((val) => val.maxPricePaise >= val.minPricePaise, {
    message: 'maxPricePaise must be greater than or equal to minPricePaise',
    path: ['maxPricePaise'],
  });

/**
 * Validates storefront availability adhering to Decisions #48 & #50.
 */
export const storefrontAvailabilityDtoSchema = z
  .object({
    availabilityUnknown: z.boolean(),
    isAvailable: z.boolean().nullable(),
    serviceAreaId: storefrontObjectIdSchema.nullable(),
    minLeadTimeHours: z.number().int().min(MIN_LEAD_TIME_HOURS).nullable(),
    availablePartnerCount: z.number().int().min(0).nullable(),
    message: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    // Unlocalized Semantics (Decision #48)
    if (val.availabilityUnknown) {
      if (val.isAvailable !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['isAvailable'],
          message: 'isAvailable must be strictly null when availabilityUnknown is true',
        });
      }
      if (val.serviceAreaId !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceAreaId'],
          message: 'serviceAreaId must be strictly null when availabilityUnknown is true',
        });
      }
      if (val.minLeadTimeHours !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['minLeadTimeHours'],
          message: 'minLeadTimeHours must be strictly null when availabilityUnknown is true',
        });
      }
      if (val.availablePartnerCount !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['availablePartnerCount'],
          message: 'availablePartnerCount must be strictly null when availabilityUnknown is true',
        });
      }
    } else {
      // Localized Semantics (Decisions #48 & #50)
      if (val.isAvailable === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['isAvailable'],
          message:
            'isAvailable must be a boolean (true or false) when availabilityUnknown is false',
        });
      }
      if (val.availablePartnerCount === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['availablePartnerCount'],
          message: 'availablePartnerCount must be an integer when availabilityUnknown is false',
        });
      }

      if (val.isAvailable === true) {
        if (val.serviceAreaId === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['serviceAreaId'],
            message: 'serviceAreaId cannot be null when isAvailable is true',
          });
        }
        if (val.minLeadTimeHours === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['minLeadTimeHours'],
            message: 'minLeadTimeHours cannot be null when isAvailable is true',
          });
        }
        if (val.availablePartnerCount !== null && val.availablePartnerCount < 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['availablePartnerCount'],
            message: 'availablePartnerCount must be at least 1 when isAvailable is true',
          });
        }
      } else if (val.isAvailable === false) {
        if (val.minLeadTimeHours !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['minLeadTimeHours'],
            message: 'minLeadTimeHours must be strictly null when isAvailable is false',
          });
        }
        if (val.availablePartnerCount !== 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['availablePartnerCount'],
            message: 'availablePartnerCount must be strictly 0 when isAvailable is false',
          });
        }
      }
    }
  });

export const storefrontLocalizationSummarySchema = z.object({
  pincode: z.string().trim().regex(PINCODE_REGEX).nullable(),
  isLocalized: z.boolean(),
  isServiceable: z.boolean(),
  serviceAreaId: storefrontObjectIdSchema.nullable(),
  serviceAreaName: z.string().nullable(),
});

export const storefrontPaginationSchema = z.object({
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1).max(MAX_STOREFRONT_LIMIT),
  totalPages: z.number().int().min(0),
  hasNextPage: z.boolean(),
  hasPrevPage: z.boolean(),
});

export const storefrontStandaloneProductCardSchema = z.object({
  id: storefrontObjectIdSchema,
  slug: z.string().trim().regex(PRODUCT_SLUG_REGEX),
  title: z.string().trim().min(1),
  brand: z.string().trim().min(1),
  hasVariants: z.literal(false),
  sku: z.string().nullable(),
  category: storefrontCategorySummarySchema,
  subcategory: storefrontCategorySummarySchema,
  images: z.array(z.string()),
  unit: storefrontUnitSummarySchema,
  pricing: storefrontPricingDtoSchema,
  availability: storefrontAvailabilityDtoSchema,
});

export const storefrontMultiVariantProductCardSchema = z.object({
  id: storefrontObjectIdSchema,
  slug: z.string().trim().regex(PRODUCT_SLUG_REGEX),
  title: z.string().trim().min(1),
  brand: z.string().trim().min(1),
  hasVariants: z.literal(true),
  variantCount: z.number().int().min(1),
  category: storefrontCategorySummarySchema,
  subcategory: storefrontCategorySummarySchema,
  images: z.array(z.string()),
  priceRange: storefrontPriceRangeDtoSchema,
  availability: storefrontAvailabilityDtoSchema,
});

export const storefrontProductCardSchema = z.discriminatedUnion('hasVariants', [
  storefrontStandaloneProductCardSchema,
  storefrontMultiVariantProductCardSchema,
]);

export const storefrontFacetsSchema = z.object({
  brands: z
    .array(
      z.object({
        brand: z.string().trim().min(1),
        count: z.number().int().min(0),
      }),
    )
    .optional(),
  subcategories: z
    .array(
      z.object({
        id: storefrontObjectIdSchema,
        slug: z.string().trim(),
        name: z.string().trim(),
        count: z.number().int().min(0),
      }),
    )
    .optional(),
});

export const storefrontProductListResponseSchema = z.object({
  items: z.array(storefrontProductCardSchema),
  pagination: storefrontPaginationSchema,
  localization: storefrontLocalizationSummarySchema,
  facets: storefrontFacetsSchema.optional(),
});

export const storefrontMasterProductDetailSchema = z.object({
  id: storefrontObjectIdSchema,
  slug: z.string().trim().regex(PRODUCT_SLUG_REGEX),
  title: z.string().trim().min(1),
  brand: z.string().trim().min(1),
  description: z.string().optional(),
  hasVariants: z.boolean(),
  sku: z.string().nullable().optional(),
  category: storefrontCategorySummarySchema,
  subcategory: storefrontCategorySummarySchema,
  images: z.array(z.string()),
  specifications: z.record(z.string(), z.string()),
  unit: storefrontUnitSummarySchema.optional(),
  pricing: storefrontPricingDtoSchema.optional(),
  availability: storefrontAvailabilityDtoSchema.optional(),
});

export const storefrontVariantDetailSchema = z.object({
  id: storefrontObjectIdSchema,
  sku: z.string().trim().min(1),
  title: z.string().trim().min(1),
  attributes: z.record(z.string(), z.string()),
  images: z.array(z.string()),
  unit: storefrontUnitSummarySchema,
  pricing: storefrontPricingDtoSchema,
  availability: storefrontAvailabilityDtoSchema,
});

export const storefrontProductDetailResponseSchema = z.object({
  product: storefrontMasterProductDetailSchema,
  variants: z.array(storefrontVariantDetailSchema),
  localization: storefrontLocalizationSummarySchema,
});
