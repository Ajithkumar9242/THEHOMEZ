import { z } from 'zod';
import {
  CANONICAL_SKU_REGEX,
  MAX_VARIANT_ATTRIBUTES,
  MAX_VARIANT_IMAGES,
  DECIMAL_STRING_REGEX,
  MAX_QUANTITY_STRING_LENGTH,
  MAX_ALLOWED_QUANTITY_PRECISION,
  UNIT_CODE_REGEX,
} from '@thehomez/shared-types';
import { objectIdRegex } from './product.schemas.js';

/**
 * URL parameter schema for variant endpoints nested under a product
 */
export const variantParamSchema = z.object({
  productId: z.string().trim().regex(objectIdRegex, 'Invalid product ID format'),
  variantId: z.string().trim().regex(objectIdRegex, 'Invalid variant ID format'),
});

/**
 * Attributes schema: non-empty dictionary with 1 to 20 key-value pairs
 */
const variantAttributesSchema = z
  .record(z.string().min(1).max(50), z.string().min(1).max(200))
  .refine(
    (obj) => Object.keys(obj).length >= 1 && Object.keys(obj).length <= MAX_VARIANT_ATTRIBUTES,
    `Attributes map must contain between 1 and ${MAX_VARIANT_ATTRIBUTES} key-value pairs`,
  );

/**
 * Variant Creation Schema
 */
export const createProductVariantSchema = z.object({
  title: z
    .string({ message: 'title is required' })
    .trim()
    .min(1, 'Variant title cannot be empty')
    .max(200, 'Variant title cannot exceed 200 characters'),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CANONICAL_SKU_REGEX, 'Variant SKU must match canonical format')
    .optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']).optional(),
  attributes: variantAttributesSchema,
  images: z
    .array(z.string().trim())
    .max(MAX_VARIANT_IMAGES, `Images cannot exceed ${MAX_VARIANT_IMAGES} URLs`)
    .optional(),
  unitCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(UNIT_CODE_REGEX, 'Invalid unit code format')
    .optional(),
  quantityPrecision: z
    .number()
    .int('quantityPrecision must be an integer')
    .min(0, 'quantityPrecision cannot be negative')
    .max(
      MAX_ALLOWED_QUANTITY_PRECISION,
      `quantityPrecision cannot exceed ${MAX_ALLOWED_QUANTITY_PRECISION}`,
    )
    .optional(),
  minOrderQuantity: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'minOrderQuantity must be a valid canonical decimal string')
    .max(
      MAX_QUANTITY_STRING_LENGTH,
      `minOrderQuantity cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
    )
    .optional(),
  maxOrderQuantity: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'maxOrderQuantity must be a valid canonical decimal string')
    .max(
      MAX_QUANTITY_STRING_LENGTH,
      `maxOrderQuantity cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
    )
    .nullable()
    .optional(),
  stepIncrement: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'stepIncrement must be a valid canonical decimal string')
    .max(
      MAX_QUANTITY_STRING_LENGTH,
      `stepIncrement cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
    )
    .optional(),
});

/**
 * Variant Update Schema
 */
export const updateProductVariantSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Variant title cannot be empty')
    .max(200, 'Variant title cannot exceed 200 characters')
    .optional(),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CANONICAL_SKU_REGEX, 'Variant SKU must match canonical format')
    .optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']).optional(),
  attributes: variantAttributesSchema.optional(),
  images: z
    .array(z.string().trim())
    .max(MAX_VARIANT_IMAGES, `Images cannot exceed ${MAX_VARIANT_IMAGES} URLs`)
    .optional(),
  unitCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(UNIT_CODE_REGEX, 'Invalid unit code format')
    .optional(),
  quantityPrecision: z
    .number()
    .int('quantityPrecision must be an integer')
    .min(0, 'quantityPrecision cannot be negative')
    .max(
      MAX_ALLOWED_QUANTITY_PRECISION,
      `quantityPrecision cannot exceed ${MAX_ALLOWED_QUANTITY_PRECISION}`,
    )
    .optional(),
  minOrderQuantity: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'minOrderQuantity must be a valid canonical decimal string')
    .max(
      MAX_QUANTITY_STRING_LENGTH,
      `minOrderQuantity cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
    )
    .optional(),
  maxOrderQuantity: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'maxOrderQuantity must be a valid canonical decimal string')
    .max(
      MAX_QUANTITY_STRING_LENGTH,
      `maxOrderQuantity cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
    )
    .nullable()
    .optional(),
  stepIncrement: z
    .string()
    .trim()
    .regex(DECIMAL_STRING_REGEX, 'stepIncrement must be a valid canonical decimal string')
    .max(
      MAX_QUANTITY_STRING_LENGTH,
      `stepIncrement cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
    )
    .optional(),
});
