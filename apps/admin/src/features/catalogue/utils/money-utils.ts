import type { MoneyPaise } from '@thehomez/shared-types';

/**
 * Monetary Safe Integer Paise Bounds.
 */
export const MAX_SAFE_PAISE = Number.MAX_SAFE_INTEGER;

/**
 * Validates whether an input represents a valid Rupee string with at most 2 decimal places.
 * Matches:
 *  - Integer rupees: "380", "0", "1250"
 *  - Decimal rupees: "380.5", "380.50", "0.75", "1250.25"
 * Rejects:
 *  - Negative values: "-100"
 *  - Leading zeros on integers: "015", "007" (accepted: "0", "0.5")
 *  - More than 2 decimal places: "10.123"
 *  - Scientific notation: "1e5"
 *  - Non-numeric or whitespace only
 */
export const RUPEE_STRING_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

/**
 * Parses a rupee input (string or number) into integer MoneyPaise without floating-point arithmetic.
 *
 * Examples:
 *   "380" -> 38000
 *   "380.5" -> 38050
 *   "380.50" -> 38050
 *   "1250.75" -> 125075
 *   "0" -> 0
 *   "0.05" -> 5
 */
export function parseRupeesToPaise(input: string | number | null | undefined): MoneyPaise {
  if (input === null || input === undefined) {
    throw new Error('Monetary value cannot be empty');
  }

  const str = String(input).trim();
  if (str.length === 0) {
    throw new Error('Monetary value cannot be empty');
  }

  if (!RUPEE_STRING_REGEX.test(str)) {
    throw new Error(
      'Monetary value must be a valid non-negative rupee amount with at most 2 decimal places',
    );
  }

  const [wholePart = '0', fractionalPart = ''] = str.split('.');
  const paddedFraction = fractionalPart.padEnd(2, '0');
  const combinedStr = wholePart + paddedFraction;

  const paiseBigInt = BigInt(combinedStr);
  if (paiseBigInt > BigInt(MAX_SAFE_PAISE)) {
    throw new Error('Monetary value exceeds maximum safe integer');
  }

  return Number(paiseBigInt);
}

/**
 * Converts integer paise into a plain decimal rupee string (e.g. 38050 -> "380.50", 38000 -> "380.00").
 * Used for populating form inputs without floating point inaccuracy.
 */
export function paiseToRupeeString(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isSafeInteger(paise) || paise < 0) {
    return '';
  }
  const p = BigInt(paise);
  const whole = p / 100n;
  const fraction = (p % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

const integerRupeesFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * Formats integer paise into a formatted Indian Rupee string (e.g. 38050 -> "₹380.50", 12500000 -> "₹1,25,000.00").
 */
export function formatPaiseToINR(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isSafeInteger(paise) || paise < 0) {
    return '—';
  }
  const p = BigInt(paise);
  const whole = p / 100n;
  const fraction = (p % 100n).toString().padStart(2, '0');
  return `₹${integerRupeesFormatter.format(Number(whole))}.${fraction}`;
}
