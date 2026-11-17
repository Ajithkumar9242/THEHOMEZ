import { z } from 'zod';
import { UserStatus } from '@thehomez/shared-types';

/**
 * Validates MongoDB 24-character hexadecimal ObjectId format.
 */
export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Standard Indian 15-character GSTIN format:
 * 2 state code digits + 5 PAN chars + 4 PAN digits + 1 PAN char + 1 entity num + 1 'Z' + 1 checksum char.
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Parser for safe non-negative integer query params.
 */
const safeIntegerQuery = z
  .union([z.string(), z.number()])
  .refine(
    (val) => {
      if (typeof val === 'number') {
        return Number.isSafeInteger(val) && val >= 0;
      }
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!/^[0-9]+$/.test(trimmed)) return false;
        const num = Number(trimmed);
        return Number.isSafeInteger(num) && num >= 0;
      }
      return false;
    },
    { message: 'Must be a valid non-negative integer' },
  )
  .transform((val) => (typeof val === 'number' ? val : Number(String(val).trim())));

/**
 * Query schema for Customer Directory listing (GET /api/v1/admin/customers)
 */
export const adminCustomerQuerySchema = z
  .object({
    page: safeIntegerQuery
      .refine((val) => val >= 1, { message: 'page must be at least 1' })
      .default(1),
    limit: safeIntegerQuery
      .refine((val) => val >= 1 && val <= 100, { message: 'limit must be between 1 and 100' })
      .default(20),
    search: z
      .string()
      .trim()
      .max(100, 'Search query cannot exceed 100 characters')
      .optional()
      .transform((val) => (val && val.length > 0 ? val : undefined)),
    status: z.nativeEnum(UserStatus).optional(),
    segment: z.enum(['B2B', 'B2C']).optional(),
    sortBy: z.enum(['createdAt', 'lastLoginAt', 'phone']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type AdminCustomerQuery = z.infer<typeof adminCustomerQuerySchema>;

/**
 * Route parameter schema validating customer ID (e.g. /:id)
 */
export const adminCustomerIdParamSchema = z
  .object({
    id: z
      .string()
      .trim()
      .regex(OBJECT_ID_REGEX, 'Customer ID must be a valid 24-character hexadecimal ObjectId'),
  })
  .strict();

/**
 * Request body schema for updating customer account status (PATCH /api/v1/admin/customers/:id/status)
 */
export const updateCustomerStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED'], {
      message: 'Status must be either ACTIVE or SUSPENDED',
    }),
    reason: z
      .string({ message: 'Audit reason is required' })
      .trim()
      .min(1, 'Reason cannot be empty')
      .max(500, 'Reason cannot exceed 500 characters'),
  })
  .strict();

export type UpdateCustomerStatusInput = z.infer<typeof updateCustomerStatusSchema>;

/**
 * Request body schema for B2B wholesale contractor verification (PATCH /api/v1/admin/customers/:id/b2b-status)
 */
export const updateCustomerB2bStatusSchema = z
  .object({
    isB2B: z.boolean({ message: 'isB2B boolean flag is required' }),
    companyName: z
      .string()
      .trim()
      .min(2, 'Company name must be at least 2 characters')
      .max(100, 'Company name cannot exceed 100 characters')
      .optional(),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(GSTIN_REGEX, 'Invalid GSTIN format (e.g. 29AAAAA0000A1Z5)')
      .optional(),
    reason: z
      .string({ message: 'Audit reason is required' })
      .trim()
      .min(1, 'Reason cannot be empty')
      .max(500, 'Reason cannot exceed 500 characters'),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.isB2B && (!data.companyName || data.companyName.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['companyName'],
        message: 'Company name is required when granting B2B wholesale status',
      });
    }
  });

export type UpdateCustomerB2bStatusInput = z.infer<typeof updateCustomerB2bStatusSchema>;
