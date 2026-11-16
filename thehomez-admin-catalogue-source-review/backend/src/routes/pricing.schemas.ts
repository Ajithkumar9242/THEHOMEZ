import { z } from 'zod';
import {
  MAX_B2B_VOLUME_TIERS,
  PINCODE_REGEX,
  DECIMAL_STRING_REGEX,
  MAX_QUANTITY_STRING_LENGTH,
} from '@thehomez/shared-types';
import { objectIdRegex } from './product.schemas.js';

/**
 * Validates a MongoDB ObjectId string.
 */
export const objectIdSchema = z.string().trim().regex(objectIdRegex, 'Invalid ObjectId format');

/**
 * Monetary Safe Integer Paise Schema.
 *
 * Enforces uniform integer minor units (Paise in INR):
 * - Must be a safe JavaScript number.
 * - Cannot be NaN or Infinite.
 * - Non-fractional (integer paise only).
 * - Non-negative (min 0).
 * - Upper bounded by Number.MAX_SAFE_INTEGER.
 */
export const moneyPaiseSchema = z
  .number()
  .refine((v) => !Number.isNaN(v) && Number.isFinite(v), {
    message: 'Monetary value must be a finite number',
  })
  .refine((v) => Number.isInteger(v), {
    message: 'Monetary value must be an integer in paise (fractional paise not permitted)',
  })
  .refine((v) => Number.isSafeInteger(v), {
    message: 'Monetary value must be a safe integer',
  })
  .refine((v) => v >= 0, {
    message: 'Monetary value cannot be negative',
  });

/**
 * Canonical Decimal Quantity String Schema.
 *
 * Enforces string decimal format matching DECIMAL_STRING_REGEX:
 * - Non-negative decimal numbers.
 * - No exponents (e.g. 1e2 rejected).
 * - No signs (+ / - rejected).
 * - No leading zeros on integers (e.g. 015 rejected, 0.15 accepted).
 * - Max length bounded by MAX_QUANTITY_STRING_LENGTH (15).
 */
export const canonicalQuantitySchema = z
  .string()
  .trim()
  .min(1, 'Quantity cannot be empty')
  .max(
    MAX_QUANTITY_STRING_LENGTH,
    `Quantity cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
  )
  .regex(DECIMAL_STRING_REGEX, 'Quantity must be a valid canonical decimal string');

/**
 * Mandatory Business Change Justification Reason Schema.
 *
 * Required for all price creations, revisions, overrides, and deactivations.
 * Strictly non-empty and non-whitespace, max 500 characters.
 */
export const changeReasonSchema = z
  .string()
  .trim()
  .min(1, 'changeReason cannot be empty or whitespace only')
  .max(500, 'changeReason cannot exceed 500 characters');

/**
 * B2B Wholesale Volume Discount Slab Schema.
 */
export const b2bVolumeTierSchema = z
  .object({
    minQuantity: canonicalQuantitySchema,
    pricePaise: moneyPaiseSchema,
  })
  .strict();

/**
 * B2B Volume Tiers Array Schema.
 * Maximum 10 slabs permitted per schedule.
 */
export const b2bTiersSchema = z
  .array(b2bVolumeTierSchema)
  .max(MAX_B2B_VOLUME_TIERS, `b2bTiers cannot exceed ${MAX_B2B_VOLUME_TIERS} volume slabs`);

/**
 * Optimistic Concurrency / Version Coordination Schema.
 */
export const expectedVersionSchema = z
  .number()
  .int('expectedVersion must be an integer')
  .min(0, 'expectedVersion must be non-negative')
  .refine((v) => Number.isSafeInteger(v), {
    message: 'expectedVersion must be a safe integer',
  });

/**
 * Standalone Product ID Path Parameter Schema.
 * URL: /api/v1/products/:id/pricing
 */
export const standalonePricingParamSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

/**
 * Variant Pricing Path Parameter Schema.
 * URL: /api/v1/products/:productId/variants/:variantId/pricing
 */
export const variantPricingParamSchema = z
  .object({
    productId: objectIdSchema,
    variantId: objectIdSchema,
  })
  .strict();

/**
 * Pricing Record ID Path Parameter Schema (for deactivation or direct lookup).
 * URL: /api/v1/pricing/:id
 */
export const pricingIdParamSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

/**
 * Set / Update Product or Variant Pricing Body Schema.
 *
 * Applicable for:
 * - PUT /api/v1/products/:id/pricing (Standalone)
 * - PUT /api/v1/products/:productId/variants/:variantId/pricing (Variant)
 *
 * Strict Object: Rejects unknown / client-injected fields (e.g. customerSegment, status, etc.).
 */
export const setPricingSchema = z
  .object({
    serviceAreaId: objectIdSchema.nullable().optional(),
    currency: z.literal('INR').default('INR').optional(),
    b2cPricePaise: moneyPaiseSchema,
    b2cMrpPaise: moneyPaiseSchema.nullable().optional(),
    b2bPricePaise: moneyPaiseSchema.nullable().optional(),
    b2bTiers: b2bTiersSchema.optional(),
    allowB2bExceedsB2c: z.boolean().default(false).optional(),
    changeReason: changeReasonSchema,
    expectedVersion: expectedVersionSchema.optional(),
  })
  .strict();

export const setStandalonePricingSchema = setPricingSchema;
export const setVariantPricingSchema = setPricingSchema;

/**
 * Administrative Pricing Inspection Query Schema.
 * GET /api/v1/products/:id/pricing?serviceAreaId=...
 */
export const getPricingQuerySchema = z
  .object({
    serviceAreaId: objectIdSchema.optional(),
  })
  .strict();

/**
 * Administrative Price History Query Schema.
 * GET /api/v1/products/:id/pricing/history?variantId=...&page=...&limit=...
 */
export const getPricingHistoryQuerySchema = z
  .object({
    variantId: objectIdSchema.optional(),
    page: z.coerce
      .number()
      .int('page must be an integer')
      .min(1, 'page must be at least 1')
      .default(1)
      .optional(),
    limit: z.coerce
      .number()
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(100, 'limit cannot exceed 100')
      .default(20)
      .optional(),
  })
  .strict();

/**
 * Pricing Deactivation Body Schema.
 * POST /api/v1/pricing/:id/deactivate
 */
export const deactivatePricingSchema = z
  .object({
    changeReason: changeReasonSchema,
    expectedVersion: expectedVersionSchema.optional(),
  })
  .strict();

/**
 * Authoritative Customer / Storefront Price Calculation Request Schema.
 * POST /api/v1/pricing/calculate
 *
 * Strict Object Validation (Zero Client Trust):
 * - Accepts only productId, optional variantId, optional deliveryPincode, and canonical quantity.
 * - Rejects arbitrary client serviceAreaId (resolved server-side strictly from deliveryPincode).
 * - Rejects client customerSegment, isB2b, unitPrice, discount, roundingMode, and status claims.
 */
export const calculatePriceSchema = z
  .object({
    productId: objectIdSchema,
    variantId: objectIdSchema.nullable().optional(),
    deliveryPincode: z
      .string()
      .trim()
      .regex(PINCODE_REGEX, 'deliveryPincode must be a valid 6-digit Indian postal PIN code')
      .nullable()
      .optional(),
    quantity: canonicalQuantitySchema,
  })
  .strict();

// Inferred TypeScript Types
export type SetPricingInput = z.infer<typeof setPricingSchema>;
export type CalculatePriceInput = z.infer<typeof calculatePriceSchema>;
export type DeactivatePricingInput = z.infer<typeof deactivatePricingSchema>;
export type GetPricingQueryInput = z.infer<typeof getPricingQuerySchema>;
export type GetPricingHistoryQueryInput = z.infer<typeof getPricingHistoryQuerySchema>;
export type VariantPricingParamInput = z.infer<typeof variantPricingParamSchema>;
export type PricingIdParamInput = z.infer<typeof pricingIdParamSchema>;
