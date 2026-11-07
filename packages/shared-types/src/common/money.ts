/**
 * Financial Currency Representation
 *
 * In accordance with SRS Section 11.8 (NFR-DATA-002) and Technical Risk TR-04:
 * All monetary amounts are strictly integer minor units (Paise in INR).
 * ₹1.00 = 100 paise. (e.g. ₹380.50 is stored as 38050).
 * Floating-point arithmetic for money is strictly prohibited across the codebase.
 */
export type MoneyPaise = number;

/**
 * Validates that a value is a valid, safe integer MoneyPaise representation.
 * Rejects non-numbers, non-integers (fractional paise), and unsafe integers.
 */
export function assertValidMoneyPaise(paise: unknown): asserts paise is MoneyPaise {
  if (typeof paise !== 'number' || !Number.isInteger(paise) || !Number.isSafeInteger(paise)) {
    throw new TypeError(`Invalid MoneyPaise value: ${paise}. Must be a safe integer.`);
  }
}

/**
 * Checks whether a value is a valid safe integer MoneyPaise.
 */
export function isValidMoneyPaise(paise: unknown): paise is MoneyPaise {
  return typeof paise === 'number' && Number.isInteger(paise) && Number.isSafeInteger(paise);
}

/**
 * Converts decimal Indian Rupees (INR) to integer Paise.
 * Rejects non-finite numbers and unsafe values.
 */
export function rupeesToPaise(rupees: number): MoneyPaise {
  if (typeof rupees !== 'number' || !Number.isFinite(rupees)) {
    throw new TypeError(`Invalid rupees value: ${rupees}. Must be a finite number.`);
  }
  const paise = Math.round(rupees * 100);
  assertValidMoneyPaise(paise);
  return paise;
}

/**
 * Converts integer Paise to decimal Indian Rupees (INR) for display purposes.
 * Throws TypeError if input is not a safe integer.
 */
export function paiseToRupees(paise: MoneyPaise): number {
  assertValidMoneyPaise(paise);
  return paise / 100;
}

/**
 * Formats integer Paise as an Indian Rupee currency string.
 * Example: 38050 -> "₹380.50"
 */
export function formatPaiseToINR(paise: MoneyPaise): string {
  assertValidMoneyPaise(paise);
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}
