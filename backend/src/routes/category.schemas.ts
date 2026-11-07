import { z } from 'zod';
import {
  CATEGORY_SLUG_REGEX,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_CATEGORY_DESC_LENGTH,
  MAX_CATEGORY_SLUG_LENGTH,
} from '@thehomez/shared-types';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Category ID URL parameter schema
 */
export const categoryIdParamSchema = z.object({
  id: z.string().trim().regex(objectIdRegex, 'Invalid category ID format'),
});

/**
 * Category Slug URL parameter schema
 */
export const categorySlugParamSchema = z.object({
  slug: z.string().trim().regex(CATEGORY_SLUG_REGEX, 'Invalid category slug format'),
});

/**
 * Query schema for category retrieval
 */
export const listCategoriesQuerySchema = z.object({
  includeInactive: z.preprocess((val) => val === 'true' || val === true, z.boolean()).optional(),
  parentId: z.string().trim().regex(objectIdRegex, 'Invalid parentId format').optional().nullable(),
});

/**
 * Administrative Category Creation Schema
 */
export const createCategorySchema = z.object({
  slug: z
    .string({ message: 'slug is required' })
    .trim()
    .toLowerCase()
    .min(2, 'slug must be at least 2 characters')
    .max(MAX_CATEGORY_SLUG_LENGTH, `slug cannot exceed ${MAX_CATEGORY_SLUG_LENGTH} characters`)
    .regex(
      CATEGORY_SLUG_REGEX,
      'slug must consist of lowercase alphanumeric characters separated by single hyphens',
    ),
  name: z
    .string({ message: 'name is required' })
    .trim()
    .min(1, 'name cannot be empty')
    .max(MAX_CATEGORY_NAME_LENGTH, `name cannot exceed ${MAX_CATEGORY_NAME_LENGTH} characters`),
  description: z
    .string()
    .trim()
    .max(
      MAX_CATEGORY_DESC_LENGTH,
      `description cannot exceed ${MAX_CATEGORY_DESC_LENGTH} characters`,
    )
    .optional(),
  parentId: z.string().trim().regex(objectIdRegex, 'Invalid parentId format').nullable().optional(),
  displayOrder: z
    .number()
    .int('displayOrder must be an integer')
    .min(0, 'displayOrder must be non-negative')
    .max(100000, 'displayOrder exceeds maximum limit')
    .default(0),
  isActive: z.boolean().default(true),
  iconUrl: z.string().trim().max(500, 'iconUrl cannot exceed 500 characters').optional(),
  imageUrl: z.string().trim().max(500, 'imageUrl cannot exceed 500 characters').optional(),
});

/**
 * Administrative Category Update Schema
 */
export const updateCategorySchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'slug must be at least 2 characters')
    .max(MAX_CATEGORY_SLUG_LENGTH, `slug cannot exceed ${MAX_CATEGORY_SLUG_LENGTH} characters`)
    .regex(
      CATEGORY_SLUG_REGEX,
      'slug must consist of lowercase alphanumeric characters separated by single hyphens',
    )
    .optional(),
  name: z
    .string()
    .trim()
    .min(1, 'name cannot be empty')
    .max(MAX_CATEGORY_NAME_LENGTH, `name cannot exceed ${MAX_CATEGORY_NAME_LENGTH} characters`)
    .optional(),
  description: z
    .string()
    .trim()
    .max(
      MAX_CATEGORY_DESC_LENGTH,
      `description cannot exceed ${MAX_CATEGORY_DESC_LENGTH} characters`,
    )
    .optional(),
  parentId: z.string().trim().regex(objectIdRegex, 'Invalid parentId format').nullable().optional(),
  displayOrder: z
    .number()
    .int('displayOrder must be an integer')
    .min(0, 'displayOrder must be non-negative')
    .max(100000, 'displayOrder exceeds maximum limit')
    .optional(),
  isActive: z.boolean().optional(),
  iconUrl: z.string().trim().max(500, 'iconUrl cannot exceed 500 characters').optional(),
  imageUrl: z.string().trim().max(500, 'imageUrl cannot exceed 500 characters').optional(),
});
