import { z } from 'zod';
import {
  PRODUCT_SLUG_REGEX,
  CANONICAL_SKU_REGEX,
  MAX_SPECIFICATION_KEYS,
  MAX_SPECIFICATION_VALUE_LENGTH,
  MAX_PRODUCT_IMAGES,
  DECIMAL_STRING_REGEX,
  MAX_QUANTITY_STRING_LENGTH,
  MAX_ALLOWED_QUANTITY_PRECISION,
  UNIT_CODE_REGEX,
} from '@thehomez/shared-types';

export const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Product ID URL parameter schema
 */
export const productIdParamSchema = z.object({
  id: z.string().trim().regex(objectIdRegex, 'Invalid product ID format'),
});

/**
 * Product Slug URL parameter schema
 */
export const productSlugParamSchema = z.object({
  slug: z.string().trim().regex(PRODUCT_SLUG_REGEX, 'Invalid product slug format'),
});

/**
 * Zod schema for bounded specifications dictionary
 */
const specificationsSchema = z
  .record(
    z.string().min(1).max(50),
    z
      .string()
      .max(
        MAX_SPECIFICATION_VALUE_LENGTH,
        `Value exceeds ${MAX_SPECIFICATION_VALUE_LENGTH} characters`,
      ),
  )
  .refine(
    (obj) => Object.keys(obj).length <= MAX_SPECIFICATION_KEYS,
    `Specifications cannot exceed ${MAX_SPECIFICATION_KEYS} keys`,
  );

/**
 * Administrative Product Creation Schema
 */
export const createProductSchema = z.object({
  title: z
    .string({ message: 'title is required' })
    .trim()
    .min(1, 'Product title cannot be empty')
    .max(200, 'Product title cannot exceed 200 characters'),
  brand: z
    .string({ message: 'brand is required' })
    .trim()
    .min(1, 'Brand cannot be empty')
    .max(100, 'Brand cannot exceed 100 characters'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      PRODUCT_SLUG_REGEX,
      'Slug must be lowercase alphanumeric words separated by single hyphens',
    )
    .max(100, 'Slug cannot exceed 100 characters')
    .optional(),
  description: z.string().trim().max(2000, 'Description cannot exceed 2000 characters').optional(),
  categoryId: z
    .string({ message: 'categoryId is required' })
    .trim()
    .regex(objectIdRegex, 'Invalid category ID format'),
  subcategoryId: z
    .string({ message: 'subcategoryId is required' })
    .trim()
    .regex(objectIdRegex, 'Invalid subcategory ID format'),
  hasVariants: z.boolean().default(false),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      CANONICAL_SKU_REGEX,
      'SKU must match canonical format (4-64 characters, uppercase alphanumeric, hyphens/underscores)',
    )
    .optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']).optional(),
  images: z
    .array(z.string().trim())
    .max(MAX_PRODUCT_IMAGES, `Images cannot exceed ${MAX_PRODUCT_IMAGES} URLs`)
    .optional(),
  specifications: specificationsSchema.optional(),
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
  publish: z.boolean().optional(),
});

/**
 * Administrative Product Update Schema
 */
export const updateProductSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Product title cannot be empty')
    .max(200, 'Product title cannot exceed 200 characters')
    .optional(),
  brand: z
    .string()
    .trim()
    .min(1, 'Brand cannot be empty')
    .max(100, 'Brand cannot exceed 100 characters')
    .optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      PRODUCT_SLUG_REGEX,
      'Slug must be lowercase alphanumeric words separated by single hyphens',
    )
    .max(100, 'Slug cannot exceed 100 characters')
    .optional(),
  description: z.string().trim().max(2000, 'Description cannot exceed 2000 characters').optional(),
  categoryId: z.string().trim().regex(objectIdRegex, 'Invalid category ID format').optional(),
  subcategoryId: z.string().trim().regex(objectIdRegex, 'Invalid subcategory ID format').optional(),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(CANONICAL_SKU_REGEX, 'SKU must match canonical format')
    .optional(),
  images: z
    .array(z.string().trim())
    .max(MAX_PRODUCT_IMAGES, `Images cannot exceed ${MAX_PRODUCT_IMAGES} URLs`)
    .optional(),
  specifications: specificationsSchema.optional(),
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
 * Query schema for admin product listing
 */
export const adminProductQuerySchema = z.object({
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1)).optional(),
  limit: z
    .preprocess((val) => (val ? Number(val) : 20), z.number().int().min(1).max(100))
    .optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
  categoryId: z.string().trim().regex(objectIdRegex, 'Invalid categoryId format').optional(),
  subcategoryId: z.string().trim().regex(objectIdRegex, 'Invalid subcategoryId format').optional(),
  brand: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

/**
 * Query schema for public product discovery
 */
export const publicProductQuerySchema = z.object({
  page: z.preprocess((val) => (val ? Number(val) : 1), z.number().int().min(1)).optional(),
  limit: z
    .preprocess((val) => (val ? Number(val) : 20), z.number().int().min(1).max(50))
    .optional(),
  category: z.string().trim().optional(),
  subcategory: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  search: z.string().trim().optional(),
});
