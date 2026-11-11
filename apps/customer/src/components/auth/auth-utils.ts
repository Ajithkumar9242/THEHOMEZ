import {
  DEFAULT_COUNTRY_CODE,
  SUPPORTED_COUNTRY_CODES,
  type CountryCodeOption,
  type NormalizedAuthError,
} from './auth-ui.types.js';

const INDIAN_LOCAL_MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * Finds metadata for a given country dial code (falls back to India +91).
 */
export function getCountryCodeOption(code: string): CountryCodeOption {
  return (
    SUPPORTED_COUNTRY_CODES.find((item) => item.code === code) ?? SUPPORTED_COUNTRY_CODES[0]!
  );
}

/**
 * Sanitizes pasted or typed phone input into local digits relative to the selected country code.
 * For India (+91), strips leading '+91', '91' (when 12 digits), or leading '0' (when 11 digits).
 */
export function sanitizePhoneInput(rawValue: string, countryCode: string): string {
  const trimmed = rawValue.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (!digitsOnly) {
    return '';
  }

  const dialDigits = countryCode.replace('+', '');

  // Handle pasted full E.164 or country-prefixed numbers (e.g. +91 98765 43210 or 919876543210)
  if (
    (trimmed.startsWith('+') || digitsOnly.length > getCountryCodeOption(countryCode).maxDigits) &&
    digitsOnly.startsWith(dialDigits)
  ) {
    const stripped = digitsOnly.slice(dialDigits.length);
    return stripped.slice(0, getCountryCodeOption(countryCode).maxDigits);
  }

  // Handle Indian 11-digit leading zero (e.g. 09876543210)
  if (countryCode === DEFAULT_COUNTRY_CODE && digitsOnly.startsWith('0') && digitsOnly.length === 11) {
    return digitsOnly.slice(1);
  }

  return digitsOnly.slice(0, getCountryCodeOption(countryCode).maxDigits);
}

/**
 * Validates local digits for the selected country code.
 * Returns a user-friendly validation message or null if valid.
 */
export function validateLocalPhone(countryCode: string, localDigits: string): string | null {
  const digits = localDigits.replace(/\D/g, '');
  const option = getCountryCodeOption(countryCode);

  if (!digits) {
    return 'Please enter your mobile number to continue.';
  }

  if (countryCode === DEFAULT_COUNTRY_CODE) {
    if (digits.length !== 10) {
      return 'Enter a valid 10-digit Indian mobile number.';
    }
    if (!INDIAN_LOCAL_MOBILE_REGEX.test(digits)) {
      return 'Indian mobile numbers must start with 6, 7, 8, or 9.';
    }
    return null;
  }

  if (digits.length < option.minDigits || digits.length > option.maxDigits) {
    return `Enter a valid ${option.minDigits}-digit mobile number for ${option.label}.`;
  }

  // Combined E.164 must be <= 15 digits total after '+'
  const e164Digits = `${countryCode.replace('+', '')}${digits}`;
  if (e164Digits.length < 8 || e164Digits.length > 15) {
    return 'Mobile number does not match international E.164 format.';
  }

  return null;
}

/**
 * Combines country code and local digits into canonical E.164 format (e.g. +919876543210).
 */
export function buildE164Phone(countryCode: string, localDigits: string): string {
  const cleanCode = countryCode.startsWith('+') ? countryCode : `+${countryCode}`;
  const cleanDigits = localDigits.replace(/\D/g, '');
  return `${cleanCode}${cleanDigits}`;
}

/**
 * Formats an E.164 phone number for readable display on the OTP screen.
 */
export function formatDisplayPhone(e164Phone: string, countryCode: string): string {
  if (!e164Phone) return '';
  if (countryCode === DEFAULT_COUNTRY_CODE && e164Phone.startsWith('+91') && e164Phone.length === 13) {
    const local = e164Phone.slice(3);
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  if (e164Phone.startsWith(countryCode)) {
    const local = e164Phone.slice(countryCode.length);
    return `${countryCode} ${local}`;
  }
  return e164Phone;
}

/**
 * Formats a remaining seconds count into human-readable countdown text.
 */
export function formatCountdownSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  if (safe <= 60) {
    return `${safe}s`;
  }
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function extractNumericDetail(details: unknown, key: string): number | undefined {
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  if (!Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    const val = record[key];
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      return Math.ceil(val);
    }
  }

  return undefined;
}

function parseSecondsFromMessage(message: string): number | undefined {
  const match = message.match(/(\d+)\s*seconds?/i);
  if (match && match[1]) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Normalizes API, AuthContext, and fetch/network errors into structured UI error states.
 */
export function normalizeAuthError(err: unknown): NormalizedAuthError {
  if (err && typeof err === 'object') {
    const errObj = err as {
      name?: unknown;
      code?: unknown;
      message?: unknown;
      status?: unknown;
      statusCode?: unknown;
      details?: unknown;
      cooldownRemainingSeconds?: unknown;
      lockoutRemainingSeconds?: unknown;
    };

    const code = typeof errObj.code === 'string' ? errObj.code : '';
    const status =
      typeof errObj.status === 'number'
        ? errObj.status
        : typeof errObj.statusCode === 'number'
          ? errObj.statusCode
          : undefined;
    const rawMessage =
      typeof errObj.message === 'string' && errObj.message.trim().length > 0
        ? errObj.message.trim()
        : 'Something went wrong. Please try again.';

    // Network / offline errors
    if (
      code === 'NETWORK_ERROR' ||
      status === 0 ||
      (err instanceof TypeError && /fetch|network|failed to fetch/i.test(rawMessage))
    ) {
      return {
        category: 'network_error',
        code: 'NETWORK_ERROR',
        message:
          'Unable to connect to TheHomez server. Please check your internet connection and try again.',
      };
    }

    if (code === 'OTP_EXPIRED') {
      return {
        category: 'otp_expired',
        code,
        message: 'This OTP has expired. Please request a new 6-digit code.',
      };
    }

    if (code === 'INVALID_OTP') {
      return {
        category: 'invalid_otp',
        code,
        message: rawMessage,
      };
    }

    if (code === 'CONCURRENT_CONSUMPTION_CONFLICT') {
      return {
        category: 'invalid_otp',
        code,
        message: 'This OTP has already been used or replaced. Please request a new code.',
      };
    }

    if (code === 'COOLDOWN_ACTIVE') {
      const topCooldown =
        typeof errObj.cooldownRemainingSeconds === 'number' &&
        Number.isFinite(errObj.cooldownRemainingSeconds) &&
        errObj.cooldownRemainingSeconds > 0
          ? Math.ceil(errObj.cooldownRemainingSeconds)
          : undefined;
      const remainingSeconds =
        topCooldown ??
        extractNumericDetail(errObj.details, 'cooldownRemainingSeconds') ??
        parseSecondsFromMessage(rawMessage);
      return {
        category: 'cooldown_active',
        code,
        message: remainingSeconds
          ? `Please wait ${formatCountdownSeconds(remainingSeconds)} before requesting another OTP.`
          : rawMessage,
        remainingSeconds,
      };
    }

    if (code === 'ACCOUNT_LOCKED') {
      const topLockout =
        typeof errObj.lockoutRemainingSeconds === 'number' &&
        Number.isFinite(errObj.lockoutRemainingSeconds) &&
        errObj.lockoutRemainingSeconds > 0
          ? Math.ceil(errObj.lockoutRemainingSeconds)
          : undefined;
      const remainingSeconds =
        topLockout ??
        extractNumericDetail(errObj.details, 'lockoutRemainingSeconds') ??
        parseSecondsFromMessage(rawMessage);
      return {
        category: 'account_locked',
        code,
        message: remainingSeconds
          ? `Too many failed attempts. Please try again in ${formatCountdownSeconds(remainingSeconds)}.`
          : rawMessage,
        remainingSeconds,
      };
    }

    if (code === 'OTP_DELIVERY_FAILED' || status === 502) {
      return {
        category: 'delivery_failed',
        code: code || 'OTP_DELIVERY_FAILED',
        message: 'We could not deliver the OTP right now. Please try again in a moment.',
      };
    }

    if (code === 'ACCOUNT_NOT_ACTIVE' || status === 403) {
      return {
        category: 'account_inactive',
        code: code || 'ACCOUNT_NOT_ACTIVE',
        message: rawMessage,
      };
    }

    if (status === 429 || code === 'RATE_LIMIT_EXCEEDED' || code === 'TOO_MANY_REQUESTS') {
      const remainingSeconds =
        extractNumericDetail(errObj.details, 'retryAfterSeconds') ??
        parseSecondsFromMessage(rawMessage);
      return {
        category: 'rate_limited',
        code: code || 'RATE_LIMIT_EXCEEDED',
        message: rawMessage || 'Too many requests. Please wait a moment before trying again.',
        remainingSeconds,
      };
    }

    if (code === 'VALIDATION_ERROR' || status === 400) {
      return {
        category: 'validation_error',
        code: code || 'VALIDATION_ERROR',
        message: rawMessage,
      };
    }

    return {
      category: 'generic',
      code: code || 'AUTH_ERROR',
      message: rawMessage,
    };
  }

  if (typeof err === 'string' && err.trim().length > 0) {
    return {
      category: 'generic',
      code: 'AUTH_ERROR',
      message: err.trim(),
    };
  }

  return {
    category: 'generic',
    code: 'AUTH_ERROR',
    message: 'Unable to complete authentication. Please try again.',
  };
}
