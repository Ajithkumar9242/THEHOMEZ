import { z } from 'zod';
import {
  PINCODE_REGEX,
  PRODUCT_SLUG_REGEX,
  STOREFRONT_SORT_OPTIONS,
  DEFAULT_STOREFRONT_SORT,
  DEFAULT_STOREFRONT_PAGE,
  DEFAULT_STOREFRONT_LIMIT,
  MIN_STOREFRONT_LIMIT,
  MAX_STOREFRONT_LIMIT,
  MIN_STOREFRONT_SEARCH_QUERY_LENGTH,
  MAX_STOREFRONT_SEARCH_QUERY_LENGTH,
} from '@thehomez/shared-types';
import { booleanQueryParamSchema } from './partner-availability.schemas.js';

/**
 * Safe Integer Query Parser Schema.
 *
 * Strictly parses non-negative safe integers from string or number representations:
 * - Accepts strings containing solely decimal digits (/^[0-9]+$/).
 * - Rejects fractional / decimal inputs (e.g. "1.5" or 1.5).
 * - Rejects negative values (e.g. "-10").
 * - Rejects scientific notation (e.g. "1e5").
 * - Rejects non-numeric strings or whitespace-only inputs.
 * - Rejects numbers exceeding Number.MAX_SAFE_INTEGER to prevent silent precision loss.
 */
export const safeIntegerQuerySchema = z
  .union([z.string(), z.number()])
  .refine(
    (val) => {
      if (typeof val === 'number') {
        return Number.isSafeInteger(val) && val >= 0;
      }
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!/^[0-9]+$/.test(trimmed)) return false;
        const num = Number(trimmed);
        return Number.isSafeInteger(num) && num >= 0;
      }
      return false;
    },
    {
      message: 'Must be a valid non-negative safe integer without decimals or exponents',
    },
  )
  .transform((val) => (typeof val === 'number' ? val : Number(val.trim())));

/**
 * Page number query schema (integer >= 1, defaults to 1).
 */
export const storefrontPageSchema = safeIntegerQuerySchema
  .refine((val) => val >= 1, {
    message: 'page must be at least 1',
  })
  .default(DEFAULT_STOREFRONT_PAGE);

/**
 * Page limit query schema (integer 1 <= limit <= 50, defaults to 20).
 * Strictly caps page size to prevent memory exhaustion and deep scan abuse.
 */
export const storefrontLimitSchema = safeIntegerQuerySchema
  .refine((val) => val >= MIN_STOREFRONT_LIMIT && val <= MAX_STOREFRONT_LIMIT, {
    message: `limit must be between ${MIN_STOREFRONT_LIMIT} and ${MAX_STOREFRONT_LIMIT}`,
  })
  .default(DEFAULT_STOREFRONT_LIMIT);

/**
 * Indian postal PIN code query schema (/^[1-9][0-9]{5}$/).
 */
export const storefrontPincodeQuerySchema = z
  .string()
  .trim()
  .regex(PINCODE_REGEX, 'pincode must be a valid 6-digit Indian postal PIN code (e.g. 560037)');

/**
 * Product or category slug parameter schema.
 */
export const storefrontSlugSchema = z
  .string()
  .trim()
  .regex(
    PRODUCT_SLUG_REGEX,
    'Slug must be lowercase alphanumeric words separated by single hyphens',
  )
  .max(100, 'Slug cannot exceed 100 characters');

/**
 * Approved storefront sorting option schema.
 */
export const storefrontSortSchema = z
  .enum(STOREFRONT_SORT_OPTIONS, {
    message: `sort must be one of: ${STOREFRONT_SORT_OPTIONS.join(', ')}`,
  })
  .default(DEFAULT_STOREFRONT_SORT);

/**
 * Monetary filter query schema (integer minor units in paise).
 * Enforces safe integer non-negative values; zero silent truncation.
 */
export const storefrontPriceFilterSchema = safeIntegerQuerySchema;

// ============================================================================
// Endpoint Request Schemas
// ============================================================================

/**
 * Query schema for Storefront Product Listing:
 * GET /api/v1/storefront/products
 *
 * Invariants:
 * - Strictly validates pagination bounds (page >= 1, 1 <= limit <= 50).
 * - inStockOnly=true strictly requires a valid pincode parameter.
 * - If both minPricePaise and maxPricePaise are provided, maxPricePaise >= minPricePaise.
 * - Rejects unexpected or client-injected fields (.strict()).
 */
export const storefrontProductQuerySchema = z
  .object({
    page: storefrontPageSchema.optional().default(DEFAULT_STOREFRONT_PAGE),
    limit: storefrontLimitSchema.optional().default(DEFAULT_STOREFRONT_LIMIT),
    category: storefrontSlugSchema.optional(),
    subcategory: storefrontSlugSchema.optional(),
    brand: z
      .string()
      .trim()
      .min(1, 'brand cannot be empty')
      .max(100, 'brand cannot exceed 100 characters')
      .optional(),
    pincode: storefrontPincodeQuerySchema.optional(),
    minPricePaise: storefrontPriceFilterSchema.optional(),
    maxPricePaise: storefrontPriceFilterSchema.optional(),
    inStockOnly: booleanQueryParamSchema.optional(),
    sort: storefrontSortSchema.optional().default(DEFAULT_STOREFRONT_SORT),
    includeFacets: booleanQueryParamSchema.optional().default(false),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Invariant: inStockOnly requires valid pincode
    if (val.inStockOnly && !val.pincode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inStockOnly'],
        message: 'inStockOnly filter requires a valid pincode',
      });
    }

    // Invariant: maxPricePaise >= minPricePaise
    if (val.minPricePaise !== undefined && val.maxPricePaise !== undefined) {
      if (val.maxPricePaise < val.minPricePaise) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxPricePaise'],
          message: 'maxPricePaise must be greater than or equal to minPricePaise',
        });
      }
    }
  });

/**
 * Path parameter schema for Storefront Product Detail:
 * GET /api/v1/storefront/products/:slug
 */
export const storefrontProductSlugParamSchema = z
  .object({
    slug: storefrontSlugSchema,
  })
  .strict();

/**
 * Query schema for Storefront Product Detail:
 * GET /api/v1/storefront/products/:slug
 */
export const storefrontProductDetailQuerySchema = z
  .object({
    pincode: storefrontPincodeQuerySchema.optional(),
  })
  .strict();

/**
 * Query schema for Storefront Keyword Search:
 * GET /api/v1/storefront/search
 *
 * Invariants:
 * - Query string `q` is mandatory, min 2 chars, max 100 chars (trimmed).
 * - inStockOnly=true strictly requires a valid pincode parameter.
 * - If both minPricePaise and maxPricePaise are provided, maxPricePaise >= minPricePaise.
 * - Rejects unexpected or client-injected fields (.strict()).
 */
export const storefrontSearchQuerySchema = z
  .object({
    q: z
      .string({ message: 'q (search query) is required' })
      .trim()
      .min(
        MIN_STOREFRONT_SEARCH_QUERY_LENGTH,
        `Search query must be at least ${MIN_STOREFRONT_SEARCH_QUERY_LENGTH} characters`,
      )
      .max(
        MAX_STOREFRONT_SEARCH_QUERY_LENGTH,
        `Search query cannot exceed ${MAX_STOREFRONT_SEARCH_QUERY_LENGTH} characters`,
      ),
    page: storefrontPageSchema.optional().default(DEFAULT_STOREFRONT_PAGE),
    limit: storefrontLimitSchema.optional().default(DEFAULT_STOREFRONT_LIMIT),
    category: storefrontSlugSchema.optional(),
    subcategory: storefrontSlugSchema.optional(),
    brand: z
      .string()
      .trim()
      .min(1, 'brand cannot be empty')
      .max(100, 'brand cannot exceed 100 characters')
      .optional(),
    pincode: storefrontPincodeQuerySchema.optional(),
    minPricePaise: storefrontPriceFilterSchema.optional(),
    maxPricePaise: storefrontPriceFilterSchema.optional(),
    inStockOnly: booleanQueryParamSchema.optional(),
    sort: storefrontSortSchema.optional().default(DEFAULT_STOREFRONT_SORT),
    includeFacets: booleanQueryParamSchema.optional().default(false),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Invariant: inStockOnly requires valid pincode
    if (val.inStockOnly && !val.pincode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['inStockOnly'],
        message: 'inStockOnly filter requires a valid pincode',
      });
    }

    // Invariant: maxPricePaise >= minPricePaise
    if (val.minPricePaise !== undefined && val.maxPricePaise !== undefined) {
      if (val.maxPricePaise < val.minPricePaise) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['maxPricePaise'],
          message: 'maxPricePaise must be greater than or equal to minPricePaise',
        });
      }
    }
  });

// ============================================================================
// Inferred TypeScript Types
// ============================================================================

export type StorefrontProductQueryParams = z.infer<typeof storefrontProductQuerySchema>;
export type StorefrontProductSlugParams = z.infer<typeof storefrontProductSlugParamSchema>;
export type StorefrontProductDetailQueryParams = z.infer<typeof storefrontProductDetailQuerySchema>;
export type StorefrontSearchQueryParams = z.infer<typeof storefrontSearchQuerySchema>;
