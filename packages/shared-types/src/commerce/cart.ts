import { z } from 'zod';
import { MIN_LEAD_TIME_HOURS } from '../catalog/partner-availability.js';
import { PINCODE_REGEX } from '../catalog/service-area.js';
import { type StorefrontCustomerSegment } from '../catalog/storefront.js';
import {
  DECIMAL_STRING_REGEX,
  MAX_ALLOWED_QUANTITY_PRECISION,
  MAX_QUANTITY_STRING_LENGTH,
} from '../catalog/unit-rules.js';
import { type MoneyPaise } from '../common/money.js';
import { createBoundedArray } from '../common/validation.js';
import {
  commerceObjectIdSchema,
  commerceServiceAreaSummarySchema,
  type ICommerceServiceAreaSummary,
} from './address.js';

/**
 * Customer Cart, Line Item, Price Drift & Batch Validation Contracts
 *
 * @classification PROPOSED (Milestone 5B.2 & 5B.3 — Customer App & Shared Backend Contracts)
 * @governance
 * - Reuses APPROVED construction unit rules (`MAX_ALLOWED_QUANTITY_PRECISION = 3`,
 *   canonical decimal strings, `ExactDecimalQuantity`), `MoneyPaise` (`HALF_UP`),
 *   Decision #32 GST-exclusive net pricing basis, and Decisions #48 & #50 tri-state
 *   localization semantics.
 * - Zero supplier identity (`partnerId`, `businessName`, `partnerCustomSku`) exposure.
 * - Zero client-authoritative prices, stock-reservation counts, delivery-fee math,
 *   or GST/HSN calculations.
 * - Guest-to-customer duplicate/overflow/PIN-conflict merge policies remain
 *   `PROPOSED_GATED` pending Product Owner ratification; `IMigrateGuestCartResponseDto`
 *   provides structural transport without hardcoding an unapproved merge rule.
 */

// ============================================================================
// 1. Constants, Boundaries & Canonical Tuple Enums
// ============================================================================

/**
 * Maximum number of distinct line items permitted in a single cart.
 */
export const MAX_CART_ITEMS = 50;

/**
 * Sliding TTL (in days) for unauthenticated guest cart sessions.
 */
export const GUEST_CART_TTL_DAYS = 30;

/**
 * HTTP header carrying the client-generated UUID v4 guest cart session token.
 */
export const CART_SESSION_TOKEN_HEADER = 'X-Cart-Session-Token';

/**
 * Strict RFC 4122 UUID v4 format required for guest cart session tokens.
 */
export const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CART_OWNER_TYPES = ['USER', 'GUEST'] as const;
export type CartOwnerType = (typeof CART_OWNER_TYPES)[number];

export const CART_ITEM_MUTATION_MODES = ['INCREMENT', 'SET'] as const;
export type CartItemMutationMode = (typeof CART_ITEM_MUTATION_MODES)[number];

/**
 * Tri-state geographical localization status (Decisions #48 & #50).
 */
export const CART_LOCALIZATION_STATES = ['UNLOCALIZED', 'SERVICEABLE', 'UNSERVICEABLE'] as const;
export type CartLocalizationState = (typeof CART_LOCALIZATION_STATES)[number];

/**
 * Per-line deterministic evaluation states produced by server-side hydration & CartValidationService.
 */
export const CART_ITEM_STATUSES = [
  'VALID',
  'UNLOCALIZED',
  'PRODUCT_UNAVAILABLE',
  'VARIANT_UNAVAILABLE',
  'UNIT_CONSTRAINTS_CHANGED',
  'NOT_PRICED',
  'UNSERVICEABLE_AREA',
  'OUT_OF_STOCK_IN_AREA',
] as const;
export type CartItemStatus = (typeof CART_ITEM_STATUSES)[number];

/**
 * Structured cart & line validation issue codes surfaced during hydration and `POST /api/v1/cart/validate`.
 */
export const CART_VALIDATION_ISSUE_CODES = [
  'CART_EMPTY',
  'CART_UNLOCALIZED',
  'PINCODE_UNSERVICEABLE',
  'PRODUCT_UNAVAILABLE',
  'VARIANT_UNAVAILABLE',
  'UNIT_CONSTRAINTS_CHANGED',
  'NOT_PRICED',
  'UNLOCALIZED',
  'UNSERVICEABLE_AREA',
  'OUT_OF_STOCK_IN_AREA',
  'PRICE_CHANGED',
] as const;
export type CartValidationIssueCode = (typeof CART_VALIDATION_ISSUE_CODES)[number];

export const CART_VALIDATION_ISSUE_SEVERITIES = ['BLOCKING', 'WARNING'] as const;
export type CartValidationIssueSeverity = (typeof CART_VALIDATION_ISSUE_SEVERITIES)[number];

export const CART_PRICE_DRIFT_DIRECTIONS = ['INCREASED', 'DECREASED', 'UNCHANGED'] as const;
export type CartPriceDriftDirection = (typeof CART_PRICE_DRIFT_DIRECTIONS)[number];

/**
 * Net pricing basis enforced across Milestone 5B (Decision #32).
 */
export type CartPricingBasis = 'GST_EXCLUSIVE_NET';

/**
 * Mandatory commercial disclosure reminding customers that prices exclude GST and freight.
 */
export type CartPricingBasisDisclosure = 'GST_EXCLUSIVE_EXCLUDING_DELIVERY';

/**
 * Customer pricing segment resolved strictly server-side from MongoDB UserModel.
 */
export type CommerceCustomerSegment = StorefrontCustomerSegment;

// ============================================================================
// 2. Domain Error Codes
// ============================================================================

/**
 * Canonical error codes for Customer Cart, Quantity Validation & Cart Validation domains.
 */
export const CART_ERROR_CODES = {
  CUSTOMER_IDENTITY_REQUIRED: 'CUSTOMER_IDENTITY_REQUIRED',
  CART_TOKEN_REQUIRED: 'CART_TOKEN_REQUIRED',
  INVALID_CART_TOKEN: 'INVALID_CART_TOKEN',
  CART_MAX_ITEMS_EXCEEDED: 'CART_MAX_ITEMS_EXCEEDED',
  CART_ITEM_NOT_FOUND: 'CART_ITEM_NOT_FOUND',
  CART_VERSION_CONFLICT: 'CART_VERSION_CONFLICT',
  CART_MERGE_CONFLICT: 'CART_MERGE_CONFLICT',
  PRICE_DRIFT_UNACKNOWLEDGED: 'PRICE_DRIFT_UNACKNOWLEDGED',
  QUANTITY_MUST_BE_INTEGER: 'QUANTITY_MUST_BE_INTEGER',
  QUANTITY_PRECISION_EXCEEDED: 'QUANTITY_PRECISION_EXCEEDED',
  QUANTITY_BELOW_MINIMUM: 'QUANTITY_BELOW_MINIMUM',
  QUANTITY_ABOVE_MAXIMUM: 'QUANTITY_ABOVE_MAXIMUM',
  QUANTITY_STEP_INVALID: 'QUANTITY_STEP_INVALID',
  QUANTITY_MALFORMED: 'QUANTITY_MALFORMED',
} as const;

export type CartErrorCode = (typeof CART_ERROR_CODES)[keyof typeof CART_ERROR_CODES];

// ============================================================================
// 3. Cart Line Item & Price Drift Contracts
// ============================================================================

/**
 * Server-computed price drift comparing server-tracked `acknowledgedUnitPricePaise`
 * against live `PricingEngineService` unit price.
 *
 * @classification PROPOSED (Milestone 5B.3)
 */
export interface ICartItemPriceDriftDto {
  hasChanged: boolean;
  acknowledgedUnitPricePaise: MoneyPaise | null;
  currentUnitPricePaise: MoneyPaise;
  deltaPaise: MoneyPaise;
  direction: CartPriceDriftDirection;
}

/**
 * Hydrated Cart Line Item DTO.
 *
 * Strictly excludes supplier identities (`partnerId`, business names) and stores
 * only server-computed GST-exclusive net `MoneyPaise` values and canonical decimal
 * quantity strings (precision `0 <= quantityPrecision <= 3`).
 *
 * @classification PROPOSED (Milestone 5B.2 & 5B.3)
 */
export interface ICartItemDto {
  itemId: string;
  productId: string;
  variantId: string | null;
  sku: string | null;
  title: string;
  brand: string;
  slug: string;
  imageUrl: string | null;
  variantTitle: string | null;
  variantAttributes: Record<string, string>;
  unitCode: string;
  quantityPrecision: number;
  minOrderQuantity: string;
  maxOrderQuantity: string | null;
  stepIncrement: string;
  quantity: string;
  pricingTierApplied: string | null;
  tierMinQuantity: string | null;
  unitPricePaise: MoneyPaise | null;
  lineSubtotalPaise: MoneyPaise | null;
  mrpSubtotalPaise: MoneyPaise | null;
  savingsPaise: MoneyPaise | null;
  isServiceAreaOverride: boolean;
  /**
   * Server-tracked price watermark recorded at add/update/acknowledge time.
   * Used strictly for drift detection and never as an authoritative price.
   */
  acknowledgedUnitPricePaise: MoneyPaise | null;
  priceDrift: ICartItemPriceDriftDto | null;
  /**
   * Tri-state availability (Decisions #48 & #50):
   * - `availabilityUnknown: true` => `isAvailable: null`, `minLeadTimeHours: null`
   * - `availabilityUnknown: false` => `isAvailable: boolean`
   */
  isAvailable: boolean | null;
  availabilityUnknown: boolean;
  minLeadTimeHours: number | null;
  itemStatus: CartItemStatus;
  isValidForCheckout: boolean;
  statusMessage?: string | null;
  addedAt: string;
}

// ============================================================================
// 4. Cart Summary & Validation Contracts
// ============================================================================

/**
 * Hydrated Server-Authoritative Customer Cart Summary DTO.
 *
 * Represents GST-exclusive material subtotals (`materialSubtotalPaise`) without
 * delivery fee or tax calculations (Decisions #7 & #32).
 *
 * @classification PROPOSED (Milestone 5B.2)
 */
export interface ICartSummaryDto {
  cartId: string | null;
  ownerType: CartOwnerType;
  version: number;
  customerSegment: CommerceCustomerSegment;
  pincode: string | null;
  localizationState: CartLocalizationState;
  /**
   * Tri-state localization flag:
   * - `null` when `localizationState === 'UNLOCALIZED'`
   * - `true` when `localizationState === 'SERVICEABLE'`
   * - `false` when `localizationState === 'UNSERVICEABLE'`
   */
  isServiceable: boolean | null;
  serviceArea: ICommerceServiceAreaSummary | null;
  items: ICartItemDto[];
  totalItemCount: number;
  validItemCount: number;
  materialSubtotalPaise: MoneyPaise;
  currency: 'INR';
  pricingBasis: CartPricingBasis;
  pricingBasisDisclosure: CartPricingBasisDisclosure;
  hasBlockingIssues: boolean;
  hasUnacknowledgedPriceChanges: boolean;
  isValidForCheckout: boolean;
  updatedAt: string | null;
}

/**
 * Structured cart or line-level validation issue DTO.
 *
 * @classification PROPOSED (Milestone 5B.3)
 */
export interface ICartValidationIssueDto {
  code: CartValidationIssueCode;
  severity: CartValidationIssueSeverity;
  itemId: string | null;
  productId?: string | null;
  variantId?: string | null;
  message: string;
  acknowledgedUnitPricePaise?: MoneyPaise | null;
  currentUnitPricePaise?: MoneyPaise | null;
}

/**
 * Batch Cart Validation Response DTO (`POST /api/v1/cart/validate`).
 *
 * @classification PROPOSED (Milestone 5B.3)
 */
export interface ICartValidationResultDto {
  isValidForCheckout: boolean;
  evaluatedPincode: string | null;
  localizationState: CartLocalizationState;
  isServiceable: boolean | null;
  blockingReasons: ICartValidationIssueDto[];
  priceChangedItems: ICartValidationIssueDto[];
  cart: ICartSummaryDto;
}

// ============================================================================
// 5. Cart Request & Migration DTOs
// ============================================================================

/**
 * Request DTO for `POST /api/v1/cart/items`.
 *
 * @classification PROPOSED (Milestone 5B.2)
 */
export interface IAddCartItemRequestDto {
  productId: string;
  variantId?: string | null;
  quantity: string;
  mode?: CartItemMutationMode;
  pincode?: string | null;
  expectedVersion?: number;
}

/**
 * Request DTO for `PATCH /api/v1/cart/items/:itemId`.
 *
 * @classification PROPOSED (Milestone 5B.2)
 */
export interface IUpdateCartItemQuantityRequestDto {
  quantity: string;
  expectedVersion?: number;
}

/**
 * Request DTO for `PATCH /api/v1/cart/location`.
 *
 * @classification PROPOSED (Milestone 5B.2)
 */
export interface IUpdateCartLocationRequestDto {
  pincode: string | null;
  expectedVersion?: number;
}

/**
 * Request DTO for `POST /api/v1/cart/acknowledge-prices`.
 * Omit `itemIds` to acknowledge all current price changes in the cart.
 *
 * @classification PROPOSED (Milestone 5B.3)
 */
export interface IAcknowledgeCartPricesRequestDto {
  itemIds?: string[];
  expectedVersion?: number;
}

/**
 * Request DTO for `POST /api/v1/cart/validate`.
 *
 * @classification PROPOSED (Milestone 5B.3)
 */
export interface IValidateCartRequestDto {
  pincode?: string;
  addressId?: string;
  expectedVersion?: number;
}

/**
 * Request DTO for `POST /api/v1/cart/migrate`.
 *
 * @classification PROPOSED_GATED (Milestone 5B.2 — duplicate/overflow/PIN-conflict
 * merge behaviour gated on Product Owner policy sign-off)
 */
export interface IMigrateGuestCartRequestDto {
  guestSessionToken?: string;
}

/**
 * Non-binding migration notice returned when a ratified merge policy adjusts or
 * flags an item during guest-to-customer migration.
 *
 * @classification PROPOSED_GATED
 */
export interface ICartMigrationNoticeDto {
  code: string;
  message: string;
  productId?: string;
  variantId?: string | null;
}

/**
 * Response DTO for `POST /api/v1/cart/migrate`.
 *
 * @classification PROPOSED_GATED (Milestone 5B.2)
 */
export interface IMigrateGuestCartResponseDto {
  migrated: boolean;
  alreadyMigrated: boolean;
  cart: ICartSummaryDto;
  notices?: ICartMigrationNoticeDto[];
}

// ============================================================================
// 6. Shared Zod Schemas (Strict Zero-Client-Trust Validation)
// ============================================================================

export const commerceCanonicalQuantitySchema = z
  .string()
  .trim()
  .min(1, 'Quantity is required')
  .max(
    MAX_QUANTITY_STRING_LENGTH,
    `Quantity string cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
  )
  .regex(
    DECIMAL_STRING_REGEX,
    'Quantity must be a valid canonical decimal string without leading zeros or exponents',
  );

export const commerceNonNegativeMoneyPaiseSchema = z
  .number()
  .int('Monetary value must be an integer in paise')
  .min(0, 'Monetary value cannot be negative')
  .refine((val) => Number.isSafeInteger(val), 'Monetary value must be a safe integer');

export const commercePositiveMoneyPaiseSchema = z
  .number()
  .int('Monetary value must be an integer in paise')
  .positive('Monetary value must be strictly positive (> 0 paise)')
  .refine((val) => Number.isSafeInteger(val), 'Monetary value must be a safe integer');

const signedMoneyPaiseSchema = z
  .number()
  .int('Monetary delta must be an integer in paise')
  .refine((val) => Number.isSafeInteger(val), 'Monetary delta must be a safe integer');

export const guestCartTokenHeaderSchema = z
  .string()
  .trim()
  .regex(UUID_V4_REGEX, 'X-Cart-Session-Token must be a valid UUID v4');

export const cartItemIdParamSchema = z
  .object({
    itemId: commerceObjectIdSchema,
  })
  .strict();

export const addCartItemSchema = z
  .object({
    productId: commerceObjectIdSchema,
    variantId: commerceObjectIdSchema.nullable().optional(),
    quantity: commerceCanonicalQuantitySchema,
    mode: z.enum(CART_ITEM_MUTATION_MODES).optional().default('INCREMENT'),
    pincode: z
      .string()
      .trim()
      .regex(PINCODE_REGEX, 'Pincode must be a valid 6-digit Indian postal code')
      .nullable()
      .optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();

export const updateCartItemQuantitySchema = z
  .object({
    quantity: commerceCanonicalQuantitySchema,
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();

export const updateCartLocationSchema = z
  .object({
    pincode: z
      .string()
      .trim()
      .regex(PINCODE_REGEX, 'Pincode must be a valid 6-digit Indian postal code')
      .nullable(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();

export const acknowledgeCartPricesSchema = z
  .object({
    itemIds: createBoundedArray(
      commerceObjectIdSchema,
      1,
      MAX_CART_ITEMS,
      `itemIds must contain between 1 and ${MAX_CART_ITEMS} item IDs`,
    ).optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict();

export const validateCartSchema = z
  .object({
    pincode: z
      .string()
      .trim()
      .regex(PINCODE_REGEX, 'Pincode must be a valid 6-digit Indian postal code')
      .optional(),
    addressId: commerceObjectIdSchema.optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.pincode !== undefined && val.addressId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['addressId'],
        message: 'Provide either pincode or addressId, not both simultaneously',
      });
    }
  });

export const migrateGuestCartSchema = z
  .object({
    guestSessionToken: guestCartTokenHeaderSchema.optional(),
  })
  .strict();

export const cartItemPriceDriftDtoSchema = z
  .object({
    hasChanged: z.boolean(),
    acknowledgedUnitPricePaise: commercePositiveMoneyPaiseSchema.nullable(),
    currentUnitPricePaise: commercePositiveMoneyPaiseSchema,
    deltaPaise: signedMoneyPaiseSchema,
    direction: z.enum(CART_PRICE_DRIFT_DIRECTIONS),
  })
  .superRefine((val, ctx) => {
    if (val.acknowledgedUnitPricePaise === null) {
      if (val.hasChanged || val.deltaPaise !== 0 || val.direction !== 'UNCHANGED') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['hasChanged'],
          message:
            'When acknowledgedUnitPricePaise is null, hasChanged must be false, deltaPaise 0, and direction UNCHANGED',
        });
      }
      return;
    }

    const expectedDelta = val.currentUnitPricePaise - val.acknowledgedUnitPricePaise;
    if (val.deltaPaise !== expectedDelta) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deltaPaise'],
        message: 'deltaPaise must equal currentUnitPricePaise - acknowledgedUnitPricePaise',
      });
    }

    const expectedChanged = expectedDelta !== 0;
    if (val.hasChanged !== expectedChanged) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['hasChanged'],
        message: 'hasChanged must reflect whether deltaPaise is non-zero',
      });
    }

    const expectedDirection: CartPriceDriftDirection =
      expectedDelta > 0 ? 'INCREASED' : expectedDelta < 0 ? 'DECREASED' : 'UNCHANGED';
    if (val.direction !== expectedDirection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['direction'],
        message: `direction must be ${expectedDirection} for deltaPaise ${expectedDelta}`,
      });
    }
  });

export const cartItemDtoSchema = z
  .object({
    itemId: commerceObjectIdSchema,
    productId: commerceObjectIdSchema,
    variantId: commerceObjectIdSchema.nullable(),
    sku: z.string().trim().min(1).nullable(),
    title: z.string().trim().min(1),
    brand: z.string().trim().min(1),
    slug: z.string().trim().min(1),
    imageUrl: z.string().nullable(),
    variantTitle: z.string().nullable(),
    variantAttributes: z.record(z.string(), z.string()),
    unitCode: z.string().trim().min(1),
    quantityPrecision: z
      .number()
      .int()
      .min(0)
      .max(
        MAX_ALLOWED_QUANTITY_PRECISION,
        `quantityPrecision cannot exceed ${MAX_ALLOWED_QUANTITY_PRECISION}`,
      ),
    minOrderQuantity: commerceCanonicalQuantitySchema,
    maxOrderQuantity: commerceCanonicalQuantitySchema.nullable(),
    stepIncrement: commerceCanonicalQuantitySchema,
    quantity: commerceCanonicalQuantitySchema,
    pricingTierApplied: z.string().nullable(),
    tierMinQuantity: commerceCanonicalQuantitySchema.nullable(),
    unitPricePaise: commercePositiveMoneyPaiseSchema.nullable(),
    lineSubtotalPaise: commerceNonNegativeMoneyPaiseSchema.nullable(),
    mrpSubtotalPaise: commerceNonNegativeMoneyPaiseSchema.nullable(),
    savingsPaise: commerceNonNegativeMoneyPaiseSchema.nullable(),
    isServiceAreaOverride: z.boolean(),
    acknowledgedUnitPricePaise: commercePositiveMoneyPaiseSchema.nullable(),
    priceDrift: cartItemPriceDriftDtoSchema.nullable(),
    isAvailable: z.boolean().nullable(),
    availabilityUnknown: z.boolean(),
    minLeadTimeHours: z.number().int().min(MIN_LEAD_TIME_HOURS).nullable(),
    itemStatus: z.enum(CART_ITEM_STATUSES),
    isValidForCheckout: z.boolean(),
    statusMessage: z.string().nullable().optional(),
    addedAt: z.string().min(1),
  })
  .superRefine((val, ctx) => {
    // Tri-state availability invariants (Decisions #48 & #50)
    if (val.availabilityUnknown) {
      if (val.isAvailable !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['isAvailable'],
          message: 'isAvailable must be null when availabilityUnknown is true',
        });
      }
      if (val.minLeadTimeHours !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['minLeadTimeHours'],
          message: 'minLeadTimeHours must be null when availabilityUnknown is true',
        });
      }
    } else {
      if (val.isAvailable === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['isAvailable'],
          message: 'isAvailable must be a boolean when availabilityUnknown is false',
        });
      } else if (val.isAvailable === true && val.minLeadTimeHours === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['minLeadTimeHours'],
          message: 'minLeadTimeHours cannot be null when isAvailable is true',
        });
      } else if (val.isAvailable === false && val.minLeadTimeHours !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['minLeadTimeHours'],
          message: 'minLeadTimeHours must be null when isAvailable is false',
        });
      }
    }

    // Pricing vs priceDrift consistency
    if (val.unitPricePaise === null && val.priceDrift !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['priceDrift'],
        message: 'priceDrift must be null when unitPricePaise is null',
      });
    }
  });

export const cartSummaryDtoSchema = z
  .object({
    cartId: commerceObjectIdSchema.nullable(),
    ownerType: z.enum(CART_OWNER_TYPES),
    version: z.number().int().min(0),
    customerSegment: z.enum(['B2C', 'B2B']),
    pincode: z.string().trim().regex(PINCODE_REGEX).nullable(),
    localizationState: z.enum(CART_LOCALIZATION_STATES),
    isServiceable: z.boolean().nullable(),
    serviceArea: commerceServiceAreaSummarySchema.nullable(),
    items: createBoundedArray(cartItemDtoSchema, 0, MAX_CART_ITEMS),
    totalItemCount: z.number().int().min(0).max(MAX_CART_ITEMS),
    validItemCount: z.number().int().min(0).max(MAX_CART_ITEMS),
    materialSubtotalPaise: commerceNonNegativeMoneyPaiseSchema,
    currency: z.literal('INR'),
    pricingBasis: z.literal('GST_EXCLUSIVE_NET'),
    pricingBasisDisclosure: z.literal('GST_EXCLUSIVE_EXCLUDING_DELIVERY'),
    hasBlockingIssues: z.boolean(),
    hasUnacknowledgedPriceChanges: z.boolean(),
    isValidForCheckout: z.boolean(),
    updatedAt: z.string().min(1).nullable(),
  })
  .superRefine((val, ctx) => {
    // Tri-state localization invariants (Decisions #48 & #50)
    if (val.localizationState === 'UNLOCALIZED') {
      if (val.pincode !== null || val.isServiceable !== null || val.serviceArea !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['localizationState'],
          message:
            'UNLOCALIZED carts must have pincode = null, isServiceable = null, and serviceArea = null',
        });
      }
    } else if (val.localizationState === 'SERVICEABLE') {
      if (val.pincode === null || val.isServiceable !== true || val.serviceArea === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['localizationState'],
          message:
            'SERVICEABLE carts must have non-null pincode, isServiceable = true, and non-null serviceArea',
        });
      }
    } else if (val.localizationState === 'UNSERVICEABLE') {
      if (val.pincode === null || val.isServiceable !== false || val.serviceArea !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['localizationState'],
          message:
            'UNSERVICEABLE carts must have non-null pincode, isServiceable = false, and serviceArea = null',
        });
      }
    }

    if (val.totalItemCount !== val.items.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalItemCount'],
        message: 'totalItemCount must equal items.length',
      });
    }

    if (val.validItemCount > val.totalItemCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validItemCount'],
        message: 'validItemCount cannot exceed totalItemCount',
      });
    }

    if (val.items.length === 0 && (val.materialSubtotalPaise !== 0 || val.isValidForCheckout)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isValidForCheckout'],
        message: 'Empty carts must have materialSubtotalPaise = 0 and isValidForCheckout = false',
      });
    }
  });

export const cartValidationIssueDtoSchema = z.object({
  code: z.enum(CART_VALIDATION_ISSUE_CODES),
  severity: z.enum(CART_VALIDATION_ISSUE_SEVERITIES),
  itemId: commerceObjectIdSchema.nullable(),
  productId: commerceObjectIdSchema.nullable().optional(),
  variantId: commerceObjectIdSchema.nullable().optional(),
  message: z.string().trim().min(1),
  acknowledgedUnitPricePaise: commercePositiveMoneyPaiseSchema.nullable().optional(),
  currentUnitPricePaise: commercePositiveMoneyPaiseSchema.nullable().optional(),
});

export const cartValidationResultDtoSchema = z.object({
  isValidForCheckout: z.boolean(),
  evaluatedPincode: z.string().trim().regex(PINCODE_REGEX).nullable(),
  localizationState: z.enum(CART_LOCALIZATION_STATES),
  isServiceable: z.boolean().nullable(),
  blockingReasons: createBoundedArray(cartValidationIssueDtoSchema, 0, MAX_CART_ITEMS + 5),
  priceChangedItems: createBoundedArray(cartValidationIssueDtoSchema, 0, MAX_CART_ITEMS),
  cart: cartSummaryDtoSchema,
});
