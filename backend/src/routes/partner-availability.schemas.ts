import { z } from 'zod';
import {
  OBJECT_ID_REGEX,
  PINCODE_REGEX,
  createBoundedArray,
  MIN_LEAD_TIME_HOURS,
  MAX_LEAD_TIME_HOURS,
  DEFAULT_LEAD_TIME_HOURS,
  MAX_PARTNER_CUSTOM_SKU_LENGTH,
  MAX_AVAILABILITY_REASON_LENGTH,
  MIN_BATCH_AVAILABILITY_ITEMS,
  MAX_BATCH_AVAILABILITY_ITEMS,
} from '@thehomez/shared-types';

/**
 * Validates a MongoDB 24-character hexadecimal ObjectId string.
 */
export const objectIdSchema = z.string().trim().regex(OBJECT_ID_REGEX, 'Invalid ObjectId format');

/**
 * Optimistic Concurrency / Version Coordination Schema.
 * Requires a non-negative safe integer.
 */
export const expectedVersionSchema = z
  .number()
  .int('version must be an integer')
  .min(0, 'version must be non-negative')
  .refine((v) => Number.isSafeInteger(v), {
    message: 'version must be a safe integer',
  });

/**
 * Partner Custom SKU Identifier Schema.
 * Optional or defined string, max 50 characters, non-empty when supplied.
 */
export const partnerCustomSkuSchema = z
  .string()
  .trim()
  .min(1, 'partnerCustomSku cannot be empty')
  .max(
    MAX_PARTNER_CUSTOM_SKU_LENGTH,
    `Custom SKU cannot exceed ${MAX_PARTNER_CUSTOM_SKU_LENGTH} characters`,
  );

/**
 * Operational Lead Time Boundary Schema (0 to 720 hours / 30 days).
 */
export const minLeadTimeHoursSchema = z
  .number()
  .int('Lead time hours must be an integer')
  .min(MIN_LEAD_TIME_HOURS, 'Lead time hours cannot be negative')
  .max(MAX_LEAD_TIME_HOURS, `Lead time hours cannot exceed ${MAX_LEAD_TIME_HOURS} (30 days)`)
  .refine((v) => Number.isSafeInteger(v), {
    message: 'Lead time hours must be a safe integer',
  });

/**
 * Operational Availability State Change Reason Schema.
 * Optional or defined string, min 1, max 200 characters.
 */
export const availabilityReasonSchema = z
  .string()
  .trim()
  .min(1, 'Reason cannot be empty or whitespace only')
  .max(
    MAX_AVAILABILITY_REASON_LENGTH,
    `Reason cannot exceed ${MAX_AVAILABILITY_REASON_LENGTH} characters`,
  );

/**
 * Boolean Query Parameter Schema.
 * Supports string 'true' / 'false' (from URL query strings) or raw booleans.
 */
export const booleanQueryParamSchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((v) => v === 'true'),
]);

/**
 * Upsert / Link Partner Product Availability Body Schema.
 * PUT /api/v1/partner/availability
 *
 * Strict Object Validation (Zero Client Trust):
 * - Requires productId, serviceAreaId.
 * - Accepts optional variantId (defaults to null for standalone products).
 * - Accepts optional isAvailable (defaults to true).
 * - Accepts optional partnerCustomSku and minLeadTimeHours.
 * - Rejects client-injected partnerId, prices, margins, discounts, or segments.
 */
export const setPartnerAvailabilitySchema = z
  .object({
    productId: objectIdSchema,
    variantId: objectIdSchema.nullable().optional().default(null),
    serviceAreaId: objectIdSchema,
    isAvailable: z.boolean().optional().default(true),
    partnerCustomSku: partnerCustomSkuSchema.optional(),
    minLeadTimeHours: minLeadTimeHoursSchema.optional().default(DEFAULT_LEAD_TIME_HOURS),
  })
  .strict();

/**
 * Fast Binary Availability Toggle Body Schema.
 * PATCH /api/v1/partner/availability/:id
 * PATCH /api/v1/admin/partners/:partnerId/availability/:id
 *
 * Strict Object Validation:
 * - Requires boolean isAvailable.
 * - Accepts optional reason and version for optimistic concurrency control.
 * - Rejects any unknown or extraneous client fields.
 */
export const togglePartnerAvailabilitySchema = z
  .object({
    isAvailable: z.boolean({
      message: 'isAvailable is required',
    }),
    reason: availabilityReasonSchema.optional(),
    version: expectedVersionSchema.optional(),
  })
  .strict();

/**
 * Single Item Inside Batch Availability Update Payload Schema.
 */
export const batchPartnerAvailabilityItemSchema = z
  .object({
    id: objectIdSchema,
    isAvailable: z.boolean({
      message: 'isAvailable is required',
    }),
    reason: availabilityReasonSchema.optional(),
    version: expectedVersionSchema.optional(),
  })
  .strict();

/**
 * Batch Availability Update Request Payload Schema.
 * POST /api/v1/partner/availability/batch
 *
 * Enforces strict bounded array sizing (1 to 100 items) to prevent DoS.
 */
export const batchPartnerAvailabilityRequestSchema = z
  .object({
    items: createBoundedArray(
      batchPartnerAvailabilityItemSchema,
      MIN_BATCH_AVAILABILITY_ITEMS,
      MAX_BATCH_AVAILABILITY_ITEMS,
      `Batch items array must contain between ${MIN_BATCH_AVAILABILITY_ITEMS} and ${MAX_BATCH_AVAILABILITY_ITEMS} items`,
    ),
  })
  .strict();

/**
 * Partner Product Availability Listing Query Schema.
 * GET /api/v1/partner/availability
 * GET /api/v1/admin/partners/:partnerId/availability
 */
export const getPartnerAvailabilityQuerySchema = z
  .object({
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
    serviceAreaId: objectIdSchema.optional(),
    productId: objectIdSchema.optional(),
    isAvailable: booleanQueryParamSchema.optional(),
    categoryId: objectIdSchema.optional(),
    search: z.string().trim().max(100, 'search cannot exceed 100 characters').optional(),
  })
  .strict();

/**
 * Availability Record ID Path Parameter Schema.
 * GET /api/v1/partner/availability/:id
 * PATCH /api/v1/partner/availability/:id
 * GET /api/v1/partner/availability/:id/history
 */
export const partnerAvailabilityIdParamSchema = z
  .object({
    id: objectIdSchema,
  })
  .strict();

/**
 * Admin Partner ID Path Parameter Schema.
 * GET /api/v1/admin/partners/:partnerId/availability
 */
export const adminPartnerIdParamSchema = z
  .object({
    partnerId: objectIdSchema,
  })
  .strict();

/**
 * Admin Partner Availability Item Path Parameter Schema.
 * PATCH /api/v1/admin/partners/:partnerId/availability/:id
 */
export const adminPartnerAvailabilityItemParamSchema = z
  .object({
    partnerId: objectIdSchema,
    id: objectIdSchema,
  })
  .strict();

/**
 * Partner Availability History Query Schema.
 * GET /api/v1/partner/availability/:id/history
 */
export const getPartnerAvailabilityHistoryQuerySchema = z
  .object({
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
 * Public Storefront Availability Query Schema.
 * GET /api/v1/products/public (or standalone availability resolution lookup)
 */
export const publicAvailabilityQuerySchema = z
  .object({
    pincode: z
      .string()
      .trim()
      .regex(PINCODE_REGEX, 'pincode must be a valid 6-digit Indian postal PIN code')
      .optional(),
    productId: objectIdSchema.optional(),
    variantId: objectIdSchema.nullable().optional(),
  })
  .strict();

/**
 * Public Storefront Product Availability Resolution Response DTO Schema (Approved Decision #48).
 * Enforces unlocalized vs localized response invariants.
 */
export const publicProductAvailabilityDtoSchema = z
  .object({
    productId: objectIdSchema,
    variantId: objectIdSchema.nullable(),
    serviceAreaId: objectIdSchema.nullable(),
    isAvailable: z.boolean().nullable(),
    availabilityUnknown: z.boolean(),
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

// Inferred TypeScript Types
export type SetPartnerAvailabilityInput = z.infer<typeof setPartnerAvailabilitySchema>;
export type TogglePartnerAvailabilityInput = z.infer<typeof togglePartnerAvailabilitySchema>;
export type BatchPartnerAvailabilityItemInput = z.infer<typeof batchPartnerAvailabilityItemSchema>;
export type BatchPartnerAvailabilityRequestInput = z.infer<
  typeof batchPartnerAvailabilityRequestSchema
>;
export type GetPartnerAvailabilityQueryInput = z.infer<typeof getPartnerAvailabilityQuerySchema>;
export type PartnerAvailabilityIdParamInput = z.infer<typeof partnerAvailabilityIdParamSchema>;
export type AdminPartnerIdParamInput = z.infer<typeof adminPartnerIdParamSchema>;
export type AdminPartnerAvailabilityItemParamInput = z.infer<
  typeof adminPartnerAvailabilityItemParamSchema
>;
export type GetPartnerAvailabilityHistoryQueryInput = z.infer<
  typeof getPartnerAvailabilityHistoryQuerySchema
>;
export type PublicAvailabilityQueryInput = z.infer<typeof publicAvailabilityQuerySchema>;
export type PublicProductAvailabilityDtoInput = z.infer<typeof publicProductAvailabilityDtoSchema>;
