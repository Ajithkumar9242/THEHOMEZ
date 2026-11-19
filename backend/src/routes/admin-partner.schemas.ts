import { z } from 'zod';

export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

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
 * Path parameter validation schema for partner operations.
 */
export const adminPartnerIdParamSchema = z
  .object({
    partnerId: z.string().trim().regex(OBJECT_ID_REGEX, 'Invalid partner ID format'),
  })
  .strict();

export type AdminPartnerIdParam = z.infer<typeof adminPartnerIdParamSchema>;

/**
 * Query schema for Partner Directory listing (GET /api/v1/admin/partners)
 */
export const adminPartnerQuerySchema = z
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
    status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED']).optional(),
    serviceAreaId: z
      .string()
      .trim()
      .regex(OBJECT_ID_REGEX, 'Invalid service area ID format')
      .optional(),
    sortBy: z.enum(['createdAt', 'businessName', 'status', 'updatedAt']).default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();

export type AdminPartnerQuery = z.infer<typeof adminPartnerQuerySchema>;

/**
 * Request payload schema for partner lifecycle status update.
 * Accepts all four statuses at the API boundary per Stage C-8A.8 contract.
 */
export const updatePartnerStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'INACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED'], {
      message: 'Status must be one of: ACTIVE, INACTIVE, PENDING_VERIFICATION, SUSPENDED',
    }),
    reason: z
      .string({ message: 'Audit reason is required' })
      .trim()
      .min(10, 'Audit reason must be at least 10 characters')
      .max(500, 'Audit reason cannot exceed 500 characters'),
  })
  .strict();

export type UpdatePartnerStatusInput = z.infer<typeof updatePartnerStatusSchema>;

/**
 * Query schema for partner audit history (GET /api/v1/admin/partners/:partnerId/audit-logs)
 */
export const adminPartnerAuditLogsQuerySchema = z
  .object({
    page: safeIntegerQuery
      .refine((val) => val >= 1, { message: 'page must be at least 1' })
      .default(1),
    limit: safeIntegerQuery
      .refine((val) => val >= 1 && val <= 50, { message: 'limit must be between 1 and 50' })
      .default(20),
  })
  .strict();

export type AdminPartnerAuditLogsQuery = z.infer<typeof adminPartnerAuditLogsQuerySchema>;
