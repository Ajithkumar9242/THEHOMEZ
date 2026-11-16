import { z } from 'zod';

/**
 * Standard 24-character hexadecimal ObjectId regex pattern.
 */
export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/**
 * Defensive bounded array schema constructor mitigating array-based DoS (GHSA-mrhx-c7xc-m3w5).
 * Strictly caps collection elements to prevent memory exhaustion / OOM on untrusted array payloads.
 *
 * Supported call patterns:
 * - `createBoundedArray(elementSchema, minLength, maxLength, customMessage?)`
 * - `createBoundedArray(elementSchema, maxLength, customMessage?)`
 */
export function createBoundedArray<T extends z.ZodTypeAny>(
  elementSchema: T,
  minOrMaxLength: number = 100,
  maxLength?: number,
  customMessage?: string,
) {
  let min: number;
  let max: number;
  let message: string | undefined;

  if (typeof maxLength === 'number') {
    min = minOrMaxLength;
    max = maxLength;
    message = customMessage;
  } else {
    min = 0;
    max = minOrMaxLength;
    message = typeof maxLength === 'string' ? maxLength : customMessage;
  }

  let schema = z.array(elementSchema);
  if (min > 0) {
    schema = schema.min(min, {
      message: `Array must contain at least ${min} item(s)`,
    });
  }
  return schema.max(max, {
    message: message || `Array must not contain more than ${max} items`,
  });
}
