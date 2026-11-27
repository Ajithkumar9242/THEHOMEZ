import { z } from 'zod';
import { normalizePhoneNumber } from '../services/phone.utils.js';

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

/**
 * Empty query schema for endpoints that strictly do not accept query parameters.
 */
export const emptyQuerySchema = z.object({}).strict();

/**
 * Query schema for partner KYC documents listing (GET /api/v1/admin/partners/:partnerId/documents)
 * Strictly disallows any query parameters.
 */
export const adminPartnerDocumentsQuerySchema = emptyQuerySchema;

/**
 * Path parameter validation schema for partner document operations.
 * Validates both partnerId and docId as 24-character hexadecimal ObjectIds.
 */
export const adminPartnerDocParamSchema = z
  .object({
    partnerId: z.string().trim().regex(OBJECT_ID_REGEX, 'Invalid partner ID format'),
    docId: z.string().trim().regex(OBJECT_ID_REGEX, 'Invalid document ID format'),
  })
  .strict();

export type AdminPartnerDocParam = z.infer<typeof adminPartnerDocParamSchema>;

/**
 * Body schema for manual security review override (POST /api/v1/admin/partners/:partnerId/documents/:docId/scan-override)
 * Requires justification reason >= 20 characters per Blueprint P1A-11.
 */
export const scanOverrideSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(20, 'Override justification reason must be at least 20 characters')
      .max(500, 'Override justification reason cannot exceed 500 characters'),
  })
  .strict();

export type ScanOverrideInput = z.infer<typeof scanOverrideSchema>;

/**
 * Request payload schema for partner profile update (PUT /api/v1/admin/partners/:partnerId)
 * Blueprint P1A-13: Modifies partner dispatch contacts without altering UserModel login credentials,
 * unless syncPrimaryOperatorPhone is explicitly true.
 */
export const updatePartnerProfileSchema = z
  .object({
    businessName: z
      .string()
      .trim()
      .min(2, 'businessName must be at least 2 characters')
      .max(100, 'businessName cannot exceed 100 characters')
      .optional(),
    legalName: z
      .string()
      .trim()
      .max(120, 'legalName cannot exceed 120 characters')
      .nullable()
      .optional(),
    phone: z
      .string()
      .trim()
      .refine(
        (val) => {
          try {
            normalizePhoneNumber(val);
            return true;
          } catch {
            return false;
          }
        },
        { message: 'Phone number must be a valid E.164 phone string' },
      )
      .transform((val) => normalizePhoneNumber(val))
      .optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Invalid email address')
      .nullable()
      .optional(),
    deliveryMode: z.enum(['PARTNER_MANAGED', 'PLATFORM_MANAGED']).optional(),
    syncPrimaryOperatorPhone: z.boolean().optional().default(false),
    reason: z
      .string({ message: 'Audit reason is required' })
      .trim()
      .min(10, 'Audit reason must be at least 10 characters')
      .max(500, 'Audit reason cannot exceed 500 characters'),
  })
  .strict()
  .refine(
    (data) =>
      data.businessName !== undefined ||
      data.legalName !== undefined ||
      data.phone !== undefined ||
      data.email !== undefined ||
      data.deliveryMode !== undefined,
    {
      message:
        'At least one profile field (businessName, legalName, phone, email, deliveryMode) must be provided for update',
    },
  )
  .refine(
    (data) => !data.syncPrimaryOperatorPhone || data.phone !== undefined,
    {
      message: 'phone is required when syncPrimaryOperatorPhone is true',
      path: ['syncPrimaryOperatorPhone'],
    },
  );

export type UpdatePartnerProfileInput = z.infer<typeof updatePartnerProfileSchema>;

/**
 * Request payload schema for reviewing a partner KYC document (PATCH /api/v1/admin/partners/:partnerId/documents/:docId/status)
 */
export const reviewPartnerDocumentSchema = z
  .object({
    status: z.enum(['VERIFIED', 'REJECTED'], {
      message: 'Status must be either VERIFIED or REJECTED',
    }),
    rejectionReason: z
      .string()
      .trim()
      .min(10, 'Rejection reason must be at least 10 characters')
      .max(500, 'Rejection reason cannot exceed 500 characters')
      .optional(),
  })
  .strict()
  .refine(
    (data) => (data.status === 'REJECTED' ? Boolean(data.rejectionReason && data.rejectionReason.length >= 10) : true),
    {
      message: 'Rejection reason is required and must be at least 10 characters when rejecting a document',
      path: ['rejectionReason'],
    },
  );

export type ReviewPartnerDocumentInput = z.infer<typeof reviewPartnerDocumentSchema>;

/**
 * Request payload schema for partner reactivation (POST /api/v1/admin/partners/:partnerId/reactivate)
 */
export const reactivatePartnerSchema = z
  .object({
    reason: z
      .string({ message: 'Reactivation reason is required' })
      .trim()
      .min(10, 'Reactivation reason must be at least 10 characters')
      .max(500, 'Reactivation reason cannot exceed 500 characters'),
    attestations: z
      .object({
        identityVerified: z.literal(true, {
          message: 'Identity verification attestation is mandatory',
        }),
        addressVerified: z.literal(true, {
          message: 'Operating address verification attestation is mandatory',
        }),
        activeHubsConfirmed: z.literal(true, {
          message: 'Active service hub confirmation attestation is mandatory',
        }),
      })
      .strict(),
    waiver: z
      .object({
        granted: z.literal(true),
        reason: z
          .string()
          .trim()
          .min(20, 'Supervisory waiver justification reason must be at least 20 characters')
          .max(1000, 'Supervisory waiver justification reason cannot exceed 1000 characters'),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ReactivatePartnerInput = z.infer<typeof reactivatePartnerSchema>;

