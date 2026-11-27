import { z } from 'zod';
import {
  DECIMAL_STRING_REGEX,
  MAX_QUANTITY_STRING_LENGTH,
  UNIT_CODE_REGEX,
  MAX_UNIT_NAME_LENGTH,
  MAX_UNIT_DESCRIPTION_LENGTH,
  MAX_ALLOWED_QUANTITY_PRECISION,
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
  search: z.string().trim().optional(),
});

/**
 * Administrative Unit creation schema
 */
export const createUnitSchema = z
  .object({
    code: z
      .string()
      .trim()
      .transform((val) => val.toUpperCase())
      .pipe(
        z
          .string()
          .regex(
            UNIT_CODE_REGEX,
            'Unit code must be uppercase alphanumeric with underscores (2-20 characters)',
          ),
      ),
    name: z
      .string()
      .trim()
      .min(1, 'Unit name is required')
      .max(MAX_UNIT_NAME_LENGTH, `Name cannot exceed ${MAX_UNIT_NAME_LENGTH} characters`),
    symbol: z
      .string()
      .trim()
      .min(1, 'Unit symbol abbreviation is required')
      .max(10, 'Symbol cannot exceed 10 characters'),
    singularLabel: z
      .string()
      .trim()
      .min(1, 'Singular label is required')
      .max(50, 'Singular label cannot exceed 50 characters'),
    pluralLabel: z
      .string()
      .trim()
      .min(1, 'Plural label is required')
      .max(50, 'Plural label cannot exceed 50 characters'),
    description: z
      .string()
      .trim()
      .max(
        MAX_UNIT_DESCRIPTION_LENGTH,
        `Description cannot exceed ${MAX_UNIT_DESCRIPTION_LENGTH} characters`,
      )
      .optional(),
    classification: z.enum(['COUNT', 'MASS', 'LENGTH', 'AREA', 'VOLUME']),
    isDiscrete: z.boolean(),
    allowedMaxPrecision: z
      .number()
      .int('Precision ceiling must be an integer')
      .min(0, 'Precision ceiling cannot be negative')
      .max(
        MAX_ALLOWED_QUANTITY_PRECISION,
        `Precision ceiling cannot exceed ${MAX_ALLOWED_QUANTITY_PRECISION}`,
      ),
    isActive: z.boolean().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.isDiscrete && data.allowedMaxPrecision > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['allowedMaxPrecision'],
        message: 'Discrete units cannot have decimal precision (allowedMaxPrecision must be 0)',
      });
    }
    if (data.classification === 'COUNT' && !data.isDiscrete) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isDiscrete'],
        message: 'Count units must be discrete (isDiscrete must be true)',
      });
    }
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
