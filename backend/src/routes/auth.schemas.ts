import { z } from 'zod';
import { UserType } from '@thehomez/shared-types';
import { normalizePhoneNumber } from '../services/phone.utils.js';

/**
 * Validates and normalizes phone number string to E.164.
 */
const phoneSchema = z
  .string({ message: 'Phone number is required' })
  .trim()
  .min(1, 'Phone number cannot be empty')
  .max(20, 'Phone number cannot exceed 20 characters')
  .refine(
    (val) => {
      try {
        normalizePhoneNumber(val);
        return true;
      } catch {
        return false;
      }
    },
    {
      message:
        'Invalid mobile number format. Please provide a valid 10-digit Indian mobile number (e.g. +919876543210 or 9876543210)',
    },
  )
  .transform((val) => normalizePhoneNumber(val));

const userTypeSchema = z.nativeEnum(UserType, {
  message: `Invalid userType. Allowed values: ${Object.values(UserType).join(', ')}`,
});

/**
 * Defensive bounded array schema constructor mitigating GHSA-mrhx-c7xc-m3w5.
 * Strictly caps collection elements to prevent memory exhaustion / OOM on untrusted arrays.
 */
export function createBoundedArray<T extends z.ZodTypeAny>(
  elementSchema: T,
  maxLength = 100,
  customMessage?: string,
) {
  return z.array(elementSchema).max(maxLength, {
    message: customMessage || `Array must not contain more than ${maxLength} items`,
  });
}

/**
 * Schema for role assignment payloads with bounded collection limits.
 */
export const roleAssignmentSchema = z
  .object({
    roles: createBoundedArray(
      z.string().trim().min(1).max(64),
      50,
      'Roles list must not exceed 50 entries',
    ),
  })
  .strict();

export type RoleAssignmentDto = z.infer<typeof roleAssignmentSchema>;

/**
 * Schema for POST /api/v1/auth/otp/request
 * Strictly rejects unexpected privilege fields (roles, permissions, userId, partnerId).
 */
export const otpRequestSchema = z
  .object({
    phone: phoneSchema,
    userType: userTypeSchema,
  })
  .strict();

export type OtpRequestDto = z.infer<typeof otpRequestSchema>;

/**
 * Schema for POST /api/v1/auth/otp/verify
 * Strictly rejects unexpected privilege fields.
 */
export const otpVerifySchema = z
  .object({
    phone: phoneSchema,
    otp: z
      .string({ message: 'OTP code is required' })
      .trim()
      .regex(/^\d{6}$/, 'OTP code must be exactly 6 numeric digits'),
    userType: userTypeSchema,
  })
  .strict();

export type OtpVerifyDto = z.infer<typeof otpVerifySchema>;

/**
 * Schema for POST /api/v1/auth/refresh
 */
export const refreshTokenSchema = z
  .object({
    refreshToken: z
      .string({ message: 'Refresh token is required' })
      .trim()
      .min(1, 'Refresh token cannot be empty')
      .max(512, 'Refresh token cannot exceed 512 characters')
      .refine(
        (val) => {
          const parts = val.split('.');
          return parts.length === 2 && parts[0]!.length > 0 && parts[1]!.length > 0;
        },
        {
          message: 'Malformed refresh token format',
        },
      ),
  })
  .strict();

export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;

/**
 * Schema for POST /api/v1/auth/logout
 */
export const logoutSchema = z
  .object({
    refreshToken: z
      .string()
      .trim()
      .min(1, 'Refresh token cannot be empty')
      .max(512, 'Refresh token cannot exceed 512 characters')
      .refine(
        (val) => {
          const parts = val.split('.');
          return parts.length === 2 && parts[0]!.length > 0 && parts[1]!.length > 0;
        },
        {
          message: 'Malformed refresh token format',
        },
      )
      .optional(),
  })
  .strict();

export type LogoutDto = z.infer<typeof logoutSchema>;
