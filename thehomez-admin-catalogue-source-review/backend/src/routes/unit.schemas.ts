import { z } from 'zod';
import {
  DECIMAL_STRING_REGEX,
  MAX_QUANTITY_STRING_LENGTH,
  UNIT_CODE_REGEX,
} from '@thehomez/shared-types';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Unit Code URL parameter schema
 */
export const unitCodeParamSchema = z.object({
  code: z.string().trim().regex(UNIT_CODE_REGEX, 'Invalid unit code format'),
});

/**
 * Query schema for unit listing
 */
export const unitQuerySchema = z.object({
  classification: z.enum(['COUNT', 'MASS', 'LENGTH', 'AREA', 'VOLUME']).optional(),
  activeOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => (val === undefined ? true : val === 'true')),
});

/**
 * Administrative Unit update schema
 */
export const updateUnitSchema = z
  .object({
    code: z.string().optional(),
    classification: z.string().optional(),
    isDiscrete: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
    symbol: z.string().trim().min(1).max(20).optional(),
    singularLabel: z.string().trim().min(1).max(50).optional(),
    pluralLabel: z.string().trim().min(1).max(50).optional(),
    description: z.string().trim().max(500).optional(),
    allowedMaxPrecision: z.number().int().min(0).max(3).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

/**
 * Unit conversion request schema
 */
export const convertUnitSchema = z.object({
  fromUnit: z.string().trim().min(1).max(20),
  toUnit: z.string().trim().min(1).max(20),
  quantity: z
    .string()
    .trim()
    .max(
      MAX_QUANTITY_STRING_LENGTH,
      `Quantity cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
    )
    .regex(
      DECIMAL_STRING_REGEX,
      'Quantity must be a valid canonical decimal string without leading zeros or exponents',
    ),
});

/**
 * Order quantity validation request schema
 */
export const validateQuantitySchema = z.object({
  productId: z.string().trim().regex(objectIdRegex, 'Invalid product ID format'),
  variantId: z.string().trim().regex(objectIdRegex, 'Invalid variant ID format').optional(),
  quantity: z
    .string()
    .trim()
    .max(
      MAX_QUANTITY_STRING_LENGTH,
      `Quantity cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
    )
    .regex(
      DECIMAL_STRING_REGEX,
      'Quantity must be a valid canonical decimal string without leading zeros or exponents',
    ),
});
