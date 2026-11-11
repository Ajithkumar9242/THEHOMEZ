import { z } from 'zod';
import { PINCODE_REGEX } from '../catalog/service-area.js';
import { OBJECT_ID_REGEX } from '../common/validation.js';

/**
 * Customer Delivery Site Address Contracts & DTOs
 *
 * @classification PROPOSED (Milestone 5B.1 — Customer App & Shared Backend Contracts)
 * @governance
 * - Reuses APPROVED `PINCODE_REGEX` and `OBJECT_ID_REGEX`.
 * - Enforces anti-IDOR boundary (`userId` is never accepted from or exposed in client write payloads).
 * - Serviceability (`isServiceable`, `serviceArea`) is resolved dynamically against active
 *   `ServiceAreaModel` records on read/write and is never persisted as static truth on addresses.
 * - Zero vendor/partner fields are included (Decision #48).
 */

// ============================================================================
// 1. Constants & Bounds
// ============================================================================

/**
 * Maximum number of saved delivery site addresses per customer account.
 */
export const MAX_ADDRESSES_PER_CUSTOMER = 20;

/**
 * Normalized E.164 phone number regex (e.g. "+919876543210").
 */
export const E164_PHONE_REGEX = /^\+[1-9]\d{9,14}$/;

export const ADDRESS_LABEL_MIN_LENGTH = 1;
export const ADDRESS_LABEL_MAX_LENGTH = 50;

export const ADDRESS_RECIPIENT_MIN_LENGTH = 2;
export const ADDRESS_RECIPIENT_MAX_LENGTH = 100;

export const ADDRESS_STREET_MIN_LENGTH = 5;
export const ADDRESS_STREET_MAX_LENGTH = 250;

export const ADDRESS_LANDMARK_MAX_LENGTH = 100;

export const ADDRESS_CITY_MIN_LENGTH = 2;
export const ADDRESS_CITY_MAX_LENGTH = 50;

export const ADDRESS_STATE_MIN_LENGTH = 2;
export const ADDRESS_STATE_MAX_LENGTH = 50;

export const ADDRESS_SITE_CONTACT_NAME_MIN_LENGTH = 2;
export const ADDRESS_SITE_CONTACT_NAME_MAX_LENGTH = 100;

export const ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH = 300;

// ============================================================================
// 2. Domain Error Codes
// ============================================================================

/**
 * Canonical error codes for the Customer Delivery Site Address domain.
 */
export const ADDRESS_ERROR_CODES = {
  CUSTOMER_IDENTITY_REQUIRED: 'CUSTOMER_IDENTITY_REQUIRED',
  ADDRESS_NOT_FOUND: 'ADDRESS_NOT_FOUND',
  ADDRESS_LIMIT_EXCEEDED: 'ADDRESS_LIMIT_EXCEEDED',
} as const;

export type AddressErrorCode =
  (typeof ADDRESS_ERROR_CODES)[keyof typeof ADDRESS_ERROR_CODES];

// ============================================================================
// 3. Shared Sub-DTOs & Entity Contracts
// ============================================================================

/**
 * Lightweight active Service Area summary returned with address & cart responses.
 * Contains zero partner or operational margin details (Decision #48).
 */
export interface ICommerceServiceAreaSummary {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
}

/**
 * Optional on-site supervisor / receiving contact for construction site deliveries.
 */
export interface ISiteContactPerson {
  name: string;
  phone: string;
}

/**
 * Customer Delivery Site Address Read DTO.
 *
 * @classification PROPOSED (Milestone 5B.1)
 */
export interface ICustomerAddressDto {
  id: string;
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
  isDefault: boolean;
  /**
   * Live serviceability resolved dynamically against active ServiceAreaModel.
   */
  isServiceable: boolean;
  /**
   * Active service area covering `pincode`, or null when outside delivery coverage.
   */
  serviceArea: ICommerceServiceAreaSummary | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request DTO for creating a customer delivery site address (`POST /api/v1/customer/addresses`).
 *
 * @classification PROPOSED (Milestone 5B.1)
 */
export interface ICreateCustomerAddressDto {
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
  isDefault?: boolean;
}

/**
 * Request DTO for updating a customer delivery site address (`PUT /api/v1/customer/addresses/:addressId`).
 *
 * @classification PROPOSED (Milestone 5B.1)
 */
export interface IUpdateCustomerAddressDto {
  label?: string;
  recipientName?: string;
  phone?: string;
  streetAddress?: string;
  landmark?: string | null;
  city?: string;
  state?: string;
  pincode?: string;
  siteContactPerson?: ISiteContactPerson | null;
  heavyVehicleAccessInstructions?: string | null;
  isDefault?: boolean;
}

/**
 * Response DTO for deleting a customer delivery site address (`DELETE /api/v1/customer/addresses/:addressId`).
 *
 * @classification PROPOSED (Milestone 5B.1)
 */
export interface IDeleteCustomerAddressResponseDto {
  deletedAddressId: string;
  promotedDefaultAddressId: string | null;
}

// ============================================================================
// 4. Shared Zod Schemas (Strict Zero-Client-Trust Validation)
// ============================================================================

export const commerceObjectIdSchema = z
  .string()
  .trim()
  .regex(OBJECT_ID_REGEX, 'Must be a valid 24-character hexadecimal ObjectId');

export const e164PhoneSchema = z
  .string()
  .trim()
  .regex(E164_PHONE_REGEX, 'Phone number must be in valid E.164 format (e.g. +919876543210)');

export const commerceServiceAreaSummarySchema = z.object({
  id: commerceObjectIdSchema,
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  city: z.string().trim().min(1),
  state: z.string().trim().min(1),
});

export const siteContactPersonSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(
        ADDRESS_SITE_CONTACT_NAME_MIN_LENGTH,
        `Site contact name must be at least ${ADDRESS_SITE_CONTACT_NAME_MIN_LENGTH} characters`,
      )
      .max(
        ADDRESS_SITE_CONTACT_NAME_MAX_LENGTH,
        `Site contact name cannot exceed ${ADDRESS_SITE_CONTACT_NAME_MAX_LENGTH} characters`,
      ),
    phone: e164PhoneSchema,
  })
  .strict();

export const addressIdParamSchema = z
  .object({
    addressId: commerceObjectIdSchema,
  })
  .strict();

export const createCustomerAddressSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(ADDRESS_LABEL_MIN_LENGTH, 'Address label is required')
      .max(ADDRESS_LABEL_MAX_LENGTH, `Address label cannot exceed ${ADDRESS_LABEL_MAX_LENGTH} characters`),
    recipientName: z
      .string()
      .trim()
      .min(
        ADDRESS_RECIPIENT_MIN_LENGTH,
        `Recipient name must be at least ${ADDRESS_RECIPIENT_MIN_LENGTH} characters`,
      )
      .max(
        ADDRESS_RECIPIENT_MAX_LENGTH,
        `Recipient name cannot exceed ${ADDRESS_RECIPIENT_MAX_LENGTH} characters`,
      ),
    phone: e164PhoneSchema,
    streetAddress: z
      .string()
      .trim()
      .min(
        ADDRESS_STREET_MIN_LENGTH,
        `Street address must be at least ${ADDRESS_STREET_MIN_LENGTH} characters`,
      )
      .max(
        ADDRESS_STREET_MAX_LENGTH,
        `Street address cannot exceed ${ADDRESS_STREET_MAX_LENGTH} characters`,
      ),
    landmark: z
      .string()
      .trim()
      .max(
        ADDRESS_LANDMARK_MAX_LENGTH,
        `Landmark cannot exceed ${ADDRESS_LANDMARK_MAX_LENGTH} characters`,
      )
      .nullable()
      .optional(),
    city: z
      .string()
      .trim()
      .min(ADDRESS_CITY_MIN_LENGTH, `City must be at least ${ADDRESS_CITY_MIN_LENGTH} characters`)
      .max(ADDRESS_CITY_MAX_LENGTH, `City cannot exceed ${ADDRESS_CITY_MAX_LENGTH} characters`),
    state: z
      .string()
      .trim()
      .min(ADDRESS_STATE_MIN_LENGTH, `State must be at least ${ADDRESS_STATE_MIN_LENGTH} characters`)
      .max(ADDRESS_STATE_MAX_LENGTH, `State cannot exceed ${ADDRESS_STATE_MAX_LENGTH} characters`),
    pincode: z
      .string()
      .trim()
      .regex(PINCODE_REGEX, 'Pincode must be a valid 6-digit Indian postal code'),
    siteContactPerson: siteContactPersonSchema.nullable().optional(),
    heavyVehicleAccessInstructions: z
      .string()
      .trim()
      .max(
        ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH,
        `Heavy vehicle access instructions cannot exceed ${ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH} characters`,
      )
      .nullable()
      .optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

export const updateCustomerAddressSchema = createCustomerAddressSchema.partial().strict();

export const customerAddressDtoSchema = z
  .object({
    id: commerceObjectIdSchema,
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
    isDefault: z.boolean(),
    isServiceable: z.boolean(),
    serviceArea: commerceServiceAreaSummarySchema.nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .superRefine((val, ctx) => {
    if (val.isServiceable && val.serviceArea === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceArea'],
        message: 'serviceArea must be non-null when isServiceable is true',
      });
    }
    if (!val.isServiceable && val.serviceArea !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['serviceArea'],
        message: 'serviceArea must be null when isServiceable is false',
      });
    }
  });
