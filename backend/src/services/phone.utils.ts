/**
 * Phone Number Normalization and Validation Utilities
 *
 * Implements strict E.164 phone number formatting and Indian mobile-number
 * validation for TheHomez launch geography.
 */

export class InvalidPhoneError extends Error {
  public readonly code = 'INVALID_PHONE_NUMBER';
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPhoneError';
  }
}

const INDIAN_MOBILE_REGEX = /^\+91[6-9]\d{9}$/;
const GENERIC_E164_REGEX = /^\+[1-9]\d{7,14}$/;

/**
 * Normalizes an input phone number to standard E.164 format.
 *
 * Supported inputs for Indian mobile numbers:
 * - 10-digit format: "9876543210" -> "+919876543210"
 * - 11-digit leading zero format: "09876543210" -> "+919876543210"
 * - Formatted/spaced: "+91 98765 43210" or "+91-98765-43210" -> "+919876543210"
 * - Explicit E.164: "+919876543210" -> "+919876543210"
 *
 * International numbers with valid E.164 format (e.g. "+14155552671") are
 * normalized to clean E.164 without assuming Indian prefix.
 */
export function normalizePhoneNumber(rawPhone: string, defaultCountryCode = '+91'): string {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new InvalidPhoneError('Phone number must be a non-empty string');
  }

  // Remove whitespace, dashes, and parentheses
  const sanitized = rawPhone.replace(/[\s\-().]/g, '');

  if (sanitized.length === 0) {
    throw new InvalidPhoneError('Phone number must not be empty');
  }

  // Case 1: Explicit '+' prefix provided
  if (sanitized.startsWith('+')) {
    if (!GENERIC_E164_REGEX.test(sanitized)) {
      throw new InvalidPhoneError(
        'Phone number does not match E.164 international standard format',
      );
    }

    // If Indian country code (+91), enforce Indian mobile number rules (10 digits, start 6-9)
    if (sanitized.startsWith('+91')) {
      if (!INDIAN_MOBILE_REGEX.test(sanitized)) {
        throw new InvalidPhoneError(
          'Invalid Indian mobile number. Must be 10 digits starting with 6, 7, 8, or 9',
        );
      }
    }

    return sanitized;
  }

  // Case 2: Indian 11-digit format starting with 0 (e.g. 09876543210)
  if (sanitized.startsWith('0') && sanitized.length === 11) {
    const withoutZero = sanitized.slice(1);
    const candidate = `${defaultCountryCode}${withoutZero}`;
    if (!INDIAN_MOBILE_REGEX.test(candidate)) {
      throw new InvalidPhoneError(
        'Invalid Indian mobile number. Must be 10 digits starting with 6, 7, 8, or 9',
      );
    }
    return candidate;
  }

  // Case 3: Standard 10-digit Indian local mobile number
  if (/^\d{10}$/.test(sanitized)) {
    const candidate = `${defaultCountryCode}${sanitized}`;
    if (!INDIAN_MOBILE_REGEX.test(candidate)) {
      throw new InvalidPhoneError(
        'Invalid Indian mobile number. Must be 10 digits starting with 6, 7, 8, or 9',
      );
    }
    return candidate;
  }

  // Case 4: 12-digit number starting with 91 without plus (e.g. 919876543210)
  if (/^91[6-9]\d{9}$/.test(sanitized)) {
    return `+${sanitized}`;
  }

  throw new InvalidPhoneError(
    `Unsupported or invalid phone number format: "${rawPhone}". Please supply a valid mobile number`,
  );
}

/**
 * Validates whether a normalized phone number is an active, valid Indian mobile number.
 */
export function isIndianMobileNumber(phone: string): boolean {
  return INDIAN_MOBILE_REGEX.test(phone);
}
