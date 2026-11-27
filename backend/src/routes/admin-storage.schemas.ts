import { z } from 'zod';

/**
 * Validates MongoDB ObjectId route parameters for storage cleanup job endpoints.
 */
export const adminStorageJobParamSchema = z
  .object({
    jobId: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{24}$/, 'jobId must be a 24-character hexadecimal ObjectId'),
  })
  .strict();

export type AdminStorageJobParamInput = z.infer<typeof adminStorageJobParamSchema>;

/**
 * Strict schema asserting that no unexpected query parameters are passed.
 */
export const emptyQuerySchema = z.object({}).strict();

/**
 * Optional empty body schema for POST requests requiring no payload.
 */
export const emptyBodySchema = z.object({}).strict().optional();
