import { z } from 'zod';
import { createBoundedArray, OBJECT_ID_REGEX } from '../common/validation.js';

/**
 * Operational lead time boundary constants (0 to 30 days in hours).
 */
export const MIN_LEAD_TIME_HOURS = 0;
export const MAX_LEAD_TIME_HOURS = 720; // 30 days * 24 hours
export const DEFAULT_LEAD_TIME_HOURS = 0;

/**
 * Maximum character limit for partner custom SKU identifiers.
 */
export const MAX_PARTNER_CUSTOM_SKU_LENGTH = 50;

/**
 * Maximum character limit for operational availability state change reasons.
 */
export const MAX_AVAILABILITY_REASON_LENGTH = 200;

/**
 * Batch availability operation boundaries (strictly 1 to 100 items per request).
 * Mitigates array-based denial-of-service (GHSA-mrhx-c7xc-m3w5).
 */
export const MIN_BATCH_AVAILABILITY_ITEMS = 1;
export const MAX_BATCH_AVAILABILITY_ITEMS = 100;

/**
 * Binary availability state for partner stock declarations.
 * Partners declare either active stock (true) or out-of-stock (false).
 */
export type AvailabilityBinaryState = boolean;

/**
 * Storefront availability state.
 * Null strictly signifies unlocalized / unconfirmed availability before delivery PIN resolution.
 * Boolean (true / false) signifies evaluated availability in a specific service area.
 */
export type StorefrontAvailabilityState = boolean | null;

/**
 * Discriminator actions for immutable availability transition audit logs.
 */
export type AvailabilityTransitionAction =
  'CREATED' | 'TOGGLED' | 'BATCH_UPDATED' | 'CASCADE_DEACTIVATED' | 'ADMIN_OVERRIDE';

/**
 * Monotonically increasing version counter for optimistic concurrency control (OCC).
 */
export type ConcurrencyVersion = number;

/**
 * Public Storefront Availability Resolution Output DTO (Approved Decision #48).
 *
 * Enforces strict semantic invariants:
 * - Unlocalized browsing (no postal PIN code supplied):
 *   availabilityUnknown = true
 *   isAvailable = null (never false — unconfirmed availability is never falsely presented as unavailable)
 *   serviceAreaId = null
 *   minLeadTimeHours = null
 *   availablePartnerCount = null (never 0 — partner count cannot be zero when unevaluated)
 *   message = "Enter delivery PIN code to check local availability"
 *
 * - Localized browsing (valid postal PIN code resolved to a service area):
 *   availabilityUnknown = false
 *   serviceAreaId = string (resolved ServiceArea ObjectId)
 *   isAvailable = true (when >= 1 active, assigned partner has stock) | false (when 0 partners have stock)
 *   availablePartnerCount = number (actual count of active available partners)
 *   minLeadTimeHours = number (minimum lead time across available partners) | null (when out of stock)
 */
export interface IPublicProductAvailabilityDto {
  productId: string;
  variantId: string | null;
  serviceAreaId: string | null;
  /**
   * Boolean stock status when known (true / false).
   * Strictly null when availabilityUnknown is true (unlocalized browsing).
   */
  isAvailable: boolean | null;
  /**
   * Set to true when customer has not supplied a delivery PIN code.
   * Set to false once delivery PIN has been resolved to a service area.
   */
  availabilityUnknown: boolean;
  /**
   * Minimum operational delivery lead time in hours across available partners.
   * Strictly null when availabilityUnknown is true or when isAvailable is false.
   */
  minLeadTimeHours: number | null;
  /**
   * Count of active eligible partners declaring availability in the resolved service area.
   * Strictly null when availabilityUnknown is true (unlocalized browsing).
   * Set to 0 when localized browsing determines no active partner has stock.
   */
  availablePartnerCount: number | null;
  message?: string;
}

/**
 * Single Partner Availability Record Output DTO (Approved Decision #49).
 *
 * Exposes binary availability and operational metadata for a partner's item in a service area.
 * Contains ZERO pricing, volume discount, margin, commission, or currency fields.
 */
export interface IPartnerProductDto {
  id: string;
  partnerId: string;
  productId: string;
  variantId: string | null;
  serviceAreaId: string;
  isAvailable: boolean;
  partnerCustomSku?: string;
  minLeadTimeHours: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  product?: {
    title: string;
    brand: string;
    slug: string;
    sku: string | null;
    hasVariants: boolean;
    images: string[];
    unitCode?: string | null;
  };
  variant?: {
    title: string;
    sku: string;
    attributes: Record<string, string>;
    images: string[];
    unitCode?: string | null;
  };
  serviceArea?: {
    code: string;
    name: string;
    city: string;
    state: string;
  };
}

/**
 * Input DTO for configuring or upserting partner availability on a sellable SKU.
 */
export interface ISetPartnerProductAvailabilityDto {
  productId: string;
  variantId?: string | null;
  serviceAreaId: string;
  isAvailable?: boolean;
  partnerCustomSku?: string;
  minLeadTimeHours?: number;
}

/**
 * Input DTO for rapid binary availability toggle with optimistic concurrency control.
 */
export interface ITogglePartnerAvailabilityDto {
  isAvailable: boolean;
  reason?: string;
  version?: number;
}

/**
 * Single item inside a batch availability update payload.
 */
export interface IBatchPartnerAvailabilityItemDto {
  id: string;
  isAvailable: boolean;
  reason?: string;
  version?: number;
}

/**
 * Input payload for batch availability updates (Strictly bounded: 1 to 100 items).
 */
export interface IBatchPartnerAvailabilityRequestDto {
  items: IBatchPartnerAvailabilityItemDto[];
}

/**
 * Output response for batch availability updates.
 */
export interface IBatchPartnerAvailabilityResponseDto {
  updatedCount: number;
  updatedIds: string[];
}

/**
 * Historical Availability State Transition Audit Record.
 * Append-only immutable log of state changes.
 */
export interface IPartnerAvailabilityHistoryDto {
  id: string;
  partnerProductId: string;
  partnerId: string;
  productId: string;
  variantId: string | null;
  serviceAreaId: string;
  previousState: boolean | null;
  newState: boolean;
  reason?: string;
  changedBy: string;
  createdAt: string;
}

/**
 * Query filter parameters for partner inventory availability listing.
 */
export interface IPartnerAvailabilityQueryDto {
  page?: number;
  limit?: number;
  productId?: string;
  serviceAreaId?: string;
  isAvailable?: boolean;
  categoryId?: string;
  search?: string;
}

/**
 * Paginated listing response envelope for partner availability records.
 */
export interface IPartnerAvailabilityListResponseDto {
  items: IPartnerProductDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ==============================================================================
// Zod Validation Schemas (Shared Validation Layer)
// ==============================================================================

const objectIdSchema = z
  .string()
  .regex(OBJECT_ID_REGEX, 'Must be a valid 24-character hexadecimal ObjectId');

/**
 * Zod schema for query parameters on partner availability listing.
 */
export const getPartnerAvailabilityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  productId: objectIdSchema.optional(),
  serviceAreaId: objectIdSchema.optional(),
  isAvailable: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .optional(),
  categoryId: objectIdSchema.optional(),
  search: z.string().trim().max(100).optional(),
});

/**
 * Zod schema for upserting or configuring partner product availability.
 */
export const setPartnerAvailabilitySchema = z.object({
  productId: objectIdSchema,
  variantId: objectIdSchema.nullable().optional().default(null),
  serviceAreaId: objectIdSchema,
  isAvailable: z.boolean().optional().default(true),
  partnerCustomSku: z
    .string()
    .trim()
    .max(
      MAX_PARTNER_CUSTOM_SKU_LENGTH,
      `Custom SKU cannot exceed ${MAX_PARTNER_CUSTOM_SKU_LENGTH} characters`,
    )
    .optional(),
  minLeadTimeHours: z
    .number()
    .int('Lead time hours must be an integer')
    .min(MIN_LEAD_TIME_HOURS, 'Lead time hours cannot be negative')
    .max(MAX_LEAD_TIME_HOURS, `Lead time hours cannot exceed ${MAX_LEAD_TIME_HOURS} (30 days)`)
    .optional()
    .default(DEFAULT_LEAD_TIME_HOURS),
});

/**
 * Zod schema for toggling binary partner product availability.
 */
export const togglePartnerAvailabilitySchema = z.object({
  isAvailable: z.boolean({ message: 'isAvailable is required' }),
  reason: z
    .string()
    .trim()
    .max(
      MAX_AVAILABILITY_REASON_LENGTH,
      `Reason cannot exceed ${MAX_AVAILABILITY_REASON_LENGTH} characters`,
    )
    .optional(),
  version: z.number().int().min(0).optional(),
});

/**
 * Zod schema for single item inside batch availability update.
 */
export const batchPartnerAvailabilityItemSchema = z.object({
  id: objectIdSchema,
  isAvailable: z.boolean({ message: 'isAvailable is required' }),
  reason: z
    .string()
    .trim()
    .max(
      MAX_AVAILABILITY_REASON_LENGTH,
      `Reason cannot exceed ${MAX_AVAILABILITY_REASON_LENGTH} characters`,
    )
    .optional(),
  version: z.number().int().min(0).optional(),
});

/**
 * Zod schema for batch availability update request (bounded to 1-100 items).
 */
export const batchPartnerAvailabilityRequestSchema = z.object({
  items: createBoundedArray(
    batchPartnerAvailabilityItemSchema,
    MIN_BATCH_AVAILABILITY_ITEMS,
    MAX_BATCH_AVAILABILITY_ITEMS,
    `Batch items array must contain between ${MIN_BATCH_AVAILABILITY_ITEMS} and ${MAX_BATCH_AVAILABILITY_ITEMS} items`,
  ),
});

/**
 * Zod schema validating public storefront product availability resolution response DTO.
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
