import { z } from 'zod';
import { DeliveryMode } from '@thehomez/shared-types';

export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;
export const E164_PHONE_REGEX = /^\+[1-9]\d{9,14}$/;
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

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
 * Path parameter validation schema for partner application operations.
 */
export const partnerApplicationIdParamSchema = z
  .object({
    id: z.string().trim().regex(OBJECT_ID_REGEX, 'Invalid application ID format'),
  })
  .strict();

export type PartnerApplicationIdParam = z.infer<typeof partnerApplicationIdParamSchema>;

/**
 * Query schema for Partner Applications directory listing.
 */
export const adminPartnerApplicationQuerySchema = z
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
    status: z
      .enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'])
      .optional(),
    serviceAreaId: z
      .string()
      .trim()
      .regex(OBJECT_ID_REGEX, 'Invalid service area ID format')
      .optional(),
    sortBy: z.enum(['createdAt', 'businessName', 'status']).optional().default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  })
  .strict();

export type AdminPartnerApplicationQuery = z.infer<typeof adminPartnerApplicationQuerySchema>;

/**
 * Initial primary partner user input schema.
 */
export const initialUserSchema = z
  .object({
    contactName: z
      .string()
      .trim()
      .min(1, 'Contact person name is required')
      .max(100, 'Contact name cannot exceed 100 characters'),
    phone: z
      .string()
      .trim()
      .regex(E164_PHONE_REGEX, 'Contact phone number must be a valid E.164 string (+91...)'),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(EMAIL_REGEX, 'Contact email must be a valid email address')
      .optional(),
  })
  .strict();

/**
 * Create Partner Application Schema (POST /api/v1/admin/partner-applications)
 */
export const createPartnerApplicationSchema = z
  .object({
    businessName: z
      .string()
      .trim()
      .min(1, 'Business name is required')
      .max(120, 'Business name cannot exceed 120 characters'),
    legalName: z.string().trim().max(150, 'Legal name cannot exceed 150 characters').optional(),
    phone: z
      .string()
      .trim()
      .regex(E164_PHONE_REGEX, 'Business phone number must be a valid E.164 string (+91...)'),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .regex(EMAIL_REGEX, 'Business email must be a valid email address')
      .optional(),
    deliveryMode: z.nativeEnum(DeliveryMode).optional().default(DeliveryMode.PARTNER_MANAGED),
    serviceAreaIds: z
      .array(z.string().trim().regex(OBJECT_ID_REGEX, 'Invalid service area ID format'))
      .max(20, 'Cannot exceed technical maximum limit of 20 service areas')
      .optional()
      .default([]),
    previousApplicationId: z
      .string()
      .trim()
      .regex(OBJECT_ID_REGEX, 'Invalid previous application ID format')
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
    initialUser: initialUserSchema,
  })
  .strict();

export type CreatePartnerApplicationSchemaInput = z.infer<typeof createPartnerApplicationSchema>;

/**
 * Reject Partner Application Schema (POST /api/v1/admin/partner-applications/:id/reject)
 */
export const rejectPartnerApplicationSchema = z
  .object({
    refusalReasonCode: z
      .string()
      .trim()
      .min(1, 'Refusal reason code is required')
      .max(100, 'Refusal reason code cannot exceed 100 characters'),
    reason: z
      .string()
      .trim()
      .min(10, 'Rejection reason must be at least 10 characters')
      .max(500, 'Rejection reason cannot exceed 500 characters'),
  })
  .strict();

export type RejectPartnerApplicationSchemaInput = z.infer<typeof rejectPartnerApplicationSchema>;

/**
 * Withdraw Partner Application Schema (POST /api/v1/admin/partner-applications/:id/withdraw)
 */
export const withdrawPartnerApplicationSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, 'Withdrawal reason must be at least 10 characters')
      .max(500, 'Withdrawal reason cannot exceed 500 characters'),
  })
  .strict();

export type WithdrawPartnerApplicationSchemaInput = z.infer<
  typeof withdrawPartnerApplicationSchema
>;

/**
 * Approve Partner Application Schema (POST /api/v1/admin/partner-applications/:id/approve)
 */
export const approvePartnerApplicationSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(10, 'Approval reason must be at least 10 characters')
      .max(500, 'Approval reason cannot exceed 500 characters'),
    checklist: z
      .object({
        identityVerified: z.literal(true, {
          message: 'Identity verification attestation must be affirmatively confirmed (true)',
        }),
        serviceAreaConfirmed: z.literal(true, {
          message: 'Service area coverage attestation must be affirmatively confirmed (true)',
        }),
        complianceConfirmed: z.literal(true, {
          message: 'Compliance verification attestation must be affirmatively confirmed (true)',
        }),
      })
      .strict(),
  })
  .strict();

export type ApprovePartnerApplicationSchemaInput = z.infer<typeof approvePartnerApplicationSchema>;
