import { z } from 'zod';
import {
  PINCODE_REGEX,
  MAX_PINCODES_PER_SERVICE_AREA,
  MAX_SERVICE_AREAS_PER_PARTNER,
} from '@thehomez/shared-types';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Public location eligibility check query schema
 */
export const checkPincodeQuerySchema = z.object({
  pincode: z
    .string({ message: 'pincode query parameter is required' })
    .trim()
    .regex(
      PINCODE_REGEX,
      'Invalid PIN code. Must be a valid 6-digit Indian postal code starting with 1-9',
    ),
});

/**
 * Administrative Service Area Creation Schema
 */
export const createServiceAreaSchema = z.object({
  code: z
    .string({ message: 'code is required' })
    .trim()
    .min(3, 'code must be at least 3 characters')
    .max(32, 'code cannot exceed 32 characters')
    .regex(
      /^[A-Za-z0-9_-]+$/,
      'code can only contain alphanumeric characters, hyphens, and underscores',
    )
    .transform((val) => val.toUpperCase()),
  name: z
    .string({ message: 'name is required' })
    .trim()
    .min(1, 'name cannot be empty')
    .max(100, 'name cannot exceed 100 characters'),
  city: z
    .string({ message: 'city is required' })
    .trim()
    .min(1, 'city cannot be empty')
    .max(100, 'city cannot exceed 100 characters'),
  state: z
    .string({ message: 'state is required' })
    .trim()
    .min(1, 'state cannot be empty')
    .max(100, 'state cannot exceed 100 characters'),
  countryCode: z
    .string()
    .trim()
    .length(2, 'countryCode must be exactly 2 characters (ISO alpha-2)')
    .default('IN')
    .transform((val) => val.toUpperCase()),
  pincodes: z
    .array(
      z
        .string()
        .trim()
        .regex(
          PINCODE_REGEX,
          'Each PIN code must be a valid 6-digit Indian postal code starting with 1-9',
        ),
      { message: 'pincodes must be an array of strings' },
    )
    .min(1, 'At least one PIN code must be specified')
    .max(
      MAX_PINCODES_PER_SERVICE_AREA,
      `Exceeded technical maximum of ${MAX_PINCODES_PER_SERVICE_AREA} PIN codes per payload`,
    )
    .refine((pins) => new Set(pins).size === pins.length, {
      message: 'Duplicate PIN codes within the payload are not allowed',
    }),
  deliveryRadiusKm: z
    .number()
    .min(0, 'deliveryRadiusKm must be non-negative')
    .max(500, 'deliveryRadiusKm cannot exceed 500 km')
    .optional(),
  isActive: z.boolean().default(true),
});

/**
 * Administrative Service Area Update Schema
 */
export const updateServiceAreaSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, 'code must be at least 3 characters')
      .max(32, 'code cannot exceed 32 characters')
      .regex(
        /^[A-Za-z0-9_-]+$/,
        'code can only contain alphanumeric characters, hyphens, and underscores',
      )
      .transform((val) => val.toUpperCase())
      .optional(),
    name: z.string().trim().min(1).max(100).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    state: z.string().trim().min(1).max(100).optional(),
    countryCode: z
      .string()
      .trim()
      .length(2)
      .transform((val) => val.toUpperCase())
      .optional(),
    pincodes: z
      .array(
        z
          .string()
          .trim()
          .regex(
            PINCODE_REGEX,
            'Each PIN code must be a valid 6-digit Indian postal code starting with 1-9',
          ),
      )
      .min(1, 'At least one PIN code must be specified when updating pincodes')
      .max(
        MAX_PINCODES_PER_SERVICE_AREA,
        `Exceeded technical maximum of ${MAX_PINCODES_PER_SERVICE_AREA} PIN codes per payload`,
      )
      .refine((pins) => new Set(pins).size === pins.length, {
        message: 'Duplicate PIN codes within the payload are not allowed',
      })
      .optional(),
    deliveryRadiusKm: z.number().min(0).max(500).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

/**
 * Administrative Partner Service Area Assignment Schema
 */
export const assignPartnerServiceAreasSchema = z.object({
  serviceAreaIds: z
    .array(
      z
        .string()
        .trim()
        .regex(objectIdRegex, 'Each serviceAreaId must be a valid 24-character hex ObjectId'),
      { message: 'serviceAreaIds must be an array of service area IDs' },
    )
    .max(
      MAX_SERVICE_AREAS_PER_PARTNER,
      `Exceeded maximum allowed ${MAX_SERVICE_AREAS_PER_PARTNER} service areas per partner`,
    )
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Duplicate serviceAreaIds are not allowed in assignment payload',
    }),
});
