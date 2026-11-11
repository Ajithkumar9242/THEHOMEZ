import { z } from 'zod';
import { MIN_LEAD_TIME_HOURS } from '../catalog/partner-availability.js';
import { PINCODE_REGEX } from '../catalog/service-area.js';
import { MAX_ALLOWED_QUANTITY_PRECISION } from '../catalog/unit-rules.js';
import { type MoneyPaise } from '../common/money.js';
import { createBoundedArray } from '../common/validation.js';
import {
  ADDRESS_CITY_MAX_LENGTH,
  ADDRESS_CITY_MIN_LENGTH,
  ADDRESS_ERROR_CODES,
  ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH,
  ADDRESS_LABEL_MAX_LENGTH,
  ADDRESS_LABEL_MIN_LENGTH,
  ADDRESS_LANDMARK_MAX_LENGTH,
  ADDRESS_RECIPIENT_MAX_LENGTH,
  ADDRESS_RECIPIENT_MIN_LENGTH,
  ADDRESS_STATE_MAX_LENGTH,
  ADDRESS_STATE_MIN_LENGTH,
  ADDRESS_STREET_MAX_LENGTH,
  ADDRESS_STREET_MIN_LENGTH,
  commerceObjectIdSchema,
  e164PhoneSchema,
  siteContactPersonSchema,
  type ISiteContactPerson,
} from './address.js';
import {
  CART_ERROR_CODES,
  commerceCanonicalQuantitySchema,
  commerceNonNegativeMoneyPaiseSchema,
  commercePositiveMoneyPaiseSchema,
  MAX_CART_ITEMS,
  type CommerceCustomerSegment,
} from './cart.js';

/**
 * Pre-Tax, Pre-Freight Checkout Preparation & Session Snapshot Contracts
 *
 * @classification PROPOSED (Milestone 5B.4 — Customer App & Shared Backend Contracts)
 * @governance
 * - Produces an immutable, server-authoritative pre-tax, pre-freight, pre-allocation
 *   `CheckoutSession` snapshot (`status: 'PREPARED' | 'EXPIRED' | 'SUPERSEDED'`).
 * - Strictly excludes `Order`, `FulfilmentUnit`, `'CONSUMED'` status, vendor allocation
 *   (`Decision #4`), stock reservation/deduction (`Decision #5`), delivery-fee math
 *   (`Decision #7`), GST/HSN/tax invoices (`Decisions #9 & #32`), and payment execution
 *   (`Decisions #11–#13`).
 */

// ============================================================================
// 1. Constants & Status Enums
// ============================================================================

/**
 * Default validity window (in minutes) for a prepared checkout session snapshot.
 */
export const CHECKOUT_SESSION_TTL_MINUTES = 15;

/**
 * Mandatory HTTP header for idempotent checkout preparation (`POST /api/v1/checkout/prepare`).
 */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

export const MIN_IDEMPOTENCY_KEY_LENGTH = 1;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 64;

/**
 * Permitted Milestone 5B.4 checkout session states.
 * Note: `'CONSUMED'` is strictly deferred until Milestone 5B.5 Order Creation is unlocked.
 */
export const CHECKOUT_SESSION_STATUSES = ['PREPARED', 'EXPIRED', 'SUPERSEDED'] as const;
export type CheckoutSessionStatus = (typeof CHECKOUT_SESSION_STATUSES)[number];

/**
 * GST-exclusive net commercial basis (Decision #32).
 */
export const CHECKOUT_PRICING_BASIS = 'GST_EXCLUSIVE_NET' as const;
export type CheckoutPricingBasis = typeof CHECKOUT_PRICING_BASIS;

/**
 * Explicit unresolved freight indicator pending Decision #7 ratification.
 */
export const CHECKOUT_DELIVERY_FEE_STATUS = 'PENDING_DECISION_7' as const;
export type CheckoutDeliveryFeeStatus = typeof CHECKOUT_DELIVERY_FEE_STATUS;

/**
 * Explicit tax deferral indicator per Decision #32 (Phase 4 / Milestone 8).
 */
export const CHECKOUT_TAX_STATUS = 'DEFERRED_PHASE_4' as const;
export type CheckoutTaxStatus = typeof CHECKOUT_TAX_STATUS;

// ============================================================================
// 2. Domain & Aggregated Commerce Error Codes
// ============================================================================

/**
 * Canonical error codes for Checkout Preparation & Checkout Session Lookup.
 */
export const CHECKOUT_ERROR_CODES = {
  CUSTOMER_IDENTITY_REQUIRED: 'CUSTOMER_IDENTITY_REQUIRED',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  INVALID_IDEMPOTENCY_KEY: 'INVALID_IDEMPOTENCY_KEY',
  IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
  CHECKOUT_SESSION_NOT_FOUND: 'CHECKOUT_SESSION_NOT_FOUND',
  CHECKOUT_SESSION_EXPIRED: 'CHECKOUT_SESSION_EXPIRED',
  CHECKOUT_CART_INVALID: 'CHECKOUT_CART_INVALID',
  PRICE_DRIFT_UNACKNOWLEDGED: 'PRICE_DRIFT_UNACKNOWLEDGED',
  ADDRESS_NOT_FOUND: 'ADDRESS_NOT_FOUND',
  ADDRESS_UNSERVICEABLE: 'ADDRESS_UNSERVICEABLE',
} as const;

export type CheckoutErrorCode =
  (typeof CHECKOUT_ERROR_CODES)[keyof typeof CHECKOUT_ERROR_CODES];

/**
 * Unified Milestone 5B Customer Commerce Error Code registry across
 * Address, Cart, Cart Validation, and Checkout Preparation domains.
 */
export const COMMERCE_ERROR_CODES = {
  ...ADDRESS_ERROR_CODES,
  ...CART_ERROR_CODES,
  ...CHECKOUT_ERROR_CODES,
} as const;

export type CommerceErrorCode =
  (typeof COMMERCE_ERROR_CODES)[keyof typeof COMMERCE_ERROR_CODES];

// ============================================================================
// 3. Checkout Session Snapshot Contracts
// ============================================================================

/**
 * Immutable embedded delivery address snapshot captured at checkout preparation time.
 *
 * @classification PROPOSED (Milestone 5B.4)
 */
export interface ICheckoutDeliveryAddressSnapshot {
  addressId: string;
  label: string;
  recipientName: string;
  phone: string;
  streetAddress: string;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  siteContactPerson?: ISiteContactPerson | null;
  heavyVehicleAccessInstructions?: string | null;
}

/**
 * Immutable service area snapshot covering the prepared delivery destination.
 * Contains zero partner IDs or business names (Decision #48).
 *
 * @classification PROPOSED (Milestone 5B.4)
 */
export interface ICheckoutServiceAreaSnapshot {
  serviceAreaId: string;
  code: string;
  name: string;
  city: string;
  state: string;
}

/**
 * Immutable line-item pricing & unit snapshot inside a prepared CheckoutSession.
 *
 * All monetary fields are integer `MoneyPaise` on a GST-exclusive net basis.
 * Excludes vendor allocation (`partnerId`) and tax/HSN fields.
 *
 * @classification PROPOSED (Milestone 5B.4)
 */
export interface ICheckoutSessionItemSnapshot {
  productId: string;
  variantId: string | null;
  sku: string;
  title: string;
  brand: string;
  unitCode: string;
  quantityPrecision: number;
  quantity: string;
  pricingTierApplied: string;
  tierMinQuantity: string | null;
  unitPricePaise: MoneyPaise;
  lineSubtotalPaise: MoneyPaise;
  mrpSubtotalPaise: MoneyPaise | null;
  savingsPaise: MoneyPaise | null;
  minLeadTimeHours: number;
  isServiceAreaOverride: boolean;
}

/**
 * Pre-Tax, Pre-Freight Checkout Session Read DTO.
 *
 * Returned by `POST /api/v1/checkout/prepare` and `GET /api/v1/checkout/sessions/:sessionId`.
 *
 * @classification PROPOSED (Milestone 5B.4)
 */
export interface ICheckoutSessionDto {
  sessionId: string;
  cartId: string;
  cartVersion: number;
  customerSegment: CommerceCustomerSegment;
  deliveryAddressSnapshot: ICheckoutDeliveryAddressSnapshot;
  serviceAreaSnapshot: ICheckoutServiceAreaSnapshot;
  items: ICheckoutSessionItemSnapshot[];
  /**
   * Exact integer sum of `lineSubtotalPaise` across all items (GST-exclusive net basis).
   */
  materialSubtotalPaise: MoneyPaise;
  currency: 'INR';
  pricingBasis: CheckoutPricingBasis;
  deliveryFeeStatus: CheckoutDeliveryFeeStatus;
  taxStatus: CheckoutTaxStatus;
  status: CheckoutSessionStatus;
  /**
   * Indicates whether the underlying customer cart mutated after this session was prepared.
   */
  cartModifiedSincePrepare: boolean;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// 4. Checkout Preparation Request & Response DTOs
// ============================================================================

/**
 * Request DTO for `POST /api/v1/checkout/prepare`.
 *
 * Zero Client Trust: only `addressId` and optional optimistic `expectedCartVersion`
 * are accepted; prices, customer segment, service area, and totals are strictly
 * computed server-side.
 *
 * @classification PROPOSED (Milestone 5B.4)
 */
export interface IPrepareCheckoutRequestDto {
  addressId: string;
  expectedCartVersion?: number;
}

/**
 * Response DTO for `POST /api/v1/checkout/prepare`.
 *
 * @classification PROPOSED (Milestone 5B.4)
 */
export interface IPrepareCheckoutResponseDto {
  session: ICheckoutSessionDto;
  idempotentReplay: boolean;
}

// ============================================================================
// 5. Shared Zod Schemas (Strict Zero-Client-Trust Validation)
// ============================================================================

export const idempotencyKeyHeaderSchema = z
  .string({ message: 'Idempotency-Key header is required' })
  .trim()
  .min(MIN_IDEMPOTENCY_KEY_LENGTH, 'Idempotency-Key cannot be empty')
  .max(
    MAX_IDEMPOTENCY_KEY_LENGTH,
    `Idempotency-Key cannot exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
  );

export const checkoutSessionIdParamSchema = z
  .object({
    sessionId: commerceObjectIdSchema,
  })
  .strict();

export const prepareCheckoutSchema = z
  .object({
    addressId: commerceObjectIdSchema,
    expectedCartVersion: z.number().int().min(0).optional(),
  })
  .strict();

export const checkoutDeliveryAddressSnapshotSchema = z.object({
  addressId: commerceObjectIdSchema,
  label: z.string().trim().min(ADDRESS_LABEL_MIN_LENGTH).max(ADDRESS_LABEL_MAX_LENGTH),
  recipientName: z
    .string()
    .trim()
    .min(ADDRESS_RECIPIENT_MIN_LENGTH)
    .max(ADDRESS_RECIPIENT_MAX_LENGTH),
  phone: e164PhoneSchema,
  streetAddress: z
    .string()
    .trim()
    .min(ADDRESS_STREET_MIN_LENGTH)
    .max(ADDRESS_STREET_MAX_LENGTH),
  landmark: z.string().trim().max(ADDRESS_LANDMARK_MAX_LENGTH).nullable().optional(),
  city: z.string().trim().min(ADDRESS_CITY_MIN_LENGTH).max(ADDRESS_CITY_MAX_LENGTH),
  state: z.string().trim().min(ADDRESS_STATE_MIN_LENGTH).max(ADDRESS_STATE_MAX_LENGTH),
  pincode: z.string().trim().regex(PINCODE_REGEX),
  siteContactPerson: siteContactPersonSchema.nullable().optional(),
  heavyVehicleAccessInstructions: z
    .string()
    .trim()
    .max(ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH)
    .nullable()
    .optional(),
});

export const checkoutServiceAreaSnapshotSchema = z.object({
  serviceAreaId: commerceObjectIdSchema,
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  city: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

export const checkoutSessionItemSnapshotSchema = z.object({
  productId: commerceObjectIdSchema,
  variantId: commerceObjectIdSchema.nullable(),
  sku: z.string().trim().min(1),
  title: z.string().trim().min(1),
  brand: z.string().trim().min(1),
  unitCode: z.string().trim().min(1),
  quantityPrecision: z
    .number()
    .int()
    .min(0)
    .max(
      MAX_ALLOWED_QUANTITY_PRECISION,
      `quantityPrecision cannot exceed ${MAX_ALLOWED_QUANTITY_PRECISION}`,
    ),
  quantity: commerceCanonicalQuantitySchema,
  pricingTierApplied: z.string().trim().min(1),
  tierMinQuantity: commerceCanonicalQuantitySchema.nullable(),
  unitPricePaise: commercePositiveMoneyPaiseSchema,
  lineSubtotalPaise: commerceNonNegativeMoneyPaiseSchema,
  mrpSubtotalPaise: commerceNonNegativeMoneyPaiseSchema.nullable(),
  savingsPaise: commerceNonNegativeMoneyPaiseSchema.nullable(),
  minLeadTimeHours: z.number().int().min(MIN_LEAD_TIME_HOURS),
  isServiceAreaOverride: z.boolean(),
});

export const checkoutSessionDtoSchema = z
  .object({
    sessionId: commerceObjectIdSchema,
    cartId: commerceObjectIdSchema,
    cartVersion: z.number().int().min(0),
    customerSegment: z.enum(['B2C', 'B2B']),
    deliveryAddressSnapshot: checkoutDeliveryAddressSnapshotSchema,
    serviceAreaSnapshot: checkoutServiceAreaSnapshotSchema,
    items: createBoundedArray(
      checkoutSessionItemSnapshotSchema,
      1,
      MAX_CART_ITEMS,
      `Checkout session must contain between 1 and ${MAX_CART_ITEMS} items`,
    ),
    materialSubtotalPaise: commerceNonNegativeMoneyPaiseSchema,
    currency: z.literal('INR'),
    pricingBasis: z.literal(CHECKOUT_PRICING_BASIS),
    deliveryFeeStatus: z.literal(CHECKOUT_DELIVERY_FEE_STATUS),
    taxStatus: z.literal(CHECKOUT_TAX_STATUS),
    status: z.enum(CHECKOUT_SESSION_STATUSES),
    cartModifiedSincePrepare: z.boolean(),
    expiresAt: z.string().min(1),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .superRefine((val, ctx) => {
    const sum = val.items.reduce((acc, item) => acc + item.lineSubtotalPaise, 0);
    if (val.materialSubtotalPaise !== sum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['materialSubtotalPaise'],
        message: 'materialSubtotalPaise must equal exact sum of item lineSubtotalPaise values',
      });
    }
  });

export const prepareCheckoutResponseDtoSchema = z.object({
  session: checkoutSessionDtoSchema,
  idempotentReplay: z.boolean(),
});
