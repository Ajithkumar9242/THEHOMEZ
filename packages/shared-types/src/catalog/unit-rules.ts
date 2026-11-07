/**
 * Canonical Decimal and Unit Constraints & Rules
 *
 * Enforces exact decimal string validation and bounds across
 * shared types, API DTOs, Mongoose schemas, and MongoDB storage.
 */

/**
 * Regex for canonical decimal string format:
 * - Non-negative decimal numbers
 * - No exponents (e.g. 1e2 rejected)
 * - No leading zeros on integers (e.g. 015 rejected, but 0.15 accepted)
 * - Trailing decimal points without fractions rejected (e.g. 15. rejected)
 * - Signs (+ / -) rejected
 */
export const DECIMAL_STRING_REGEX = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/**
 * Maximum string length for quantity inputs (supports up to 10^11 with 3 decimals)
 */
export const MAX_QUANTITY_STRING_LENGTH = 15;

/**
 * Upper platform precision ceiling for continuous decimal units (TONNE, KG, METRE, etc.)
 */
export const MAX_ALLOWED_QUANTITY_PRECISION = 3;

/**
 * Unit master field length bounds
 */
export const MAX_UNIT_NAME_LENGTH = 100;
export const MAX_UNIT_DESCRIPTION_LENGTH = 500;
export const UNIT_CODE_REGEX = /^[A-Z0-9_]{2,20}$/;

/**
 * Core quantity configuration constraints interface
 */
export interface IQuantityConstraints {
  unitCode: string;
  quantityPrecision: number;
  minOrderQuantity: string;
  maxOrderQuantity?: string | null;
  stepIncrement: string;
}

/**
 * Validates canonical decimal string format and bounds
 */
export function validateCanonicalDecimalString(value: string): boolean {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_QUANTITY_STRING_LENGTH ||
    !DECIMAL_STRING_REGEX.test(value)
  ) {
    throw new Error(
      'Quantity must be a valid canonical decimal string without leading zeros or exponents',
    );
  }
  return true;
}
